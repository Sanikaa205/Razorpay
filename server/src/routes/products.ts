import path from 'path';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import { Router } from 'express';
import multer from 'multer';
import type {
  CsvUploadResponse,
  ProductListResponse,
  ProductResponse,
  UpdateProductRequest,
} from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { UPLOADS_DIR } from '../lib/uploads';
import { parseSizeOptions, placeholderPhotoUrl, toProductProfile } from '../lib/product';

export const productsRouter = Router();

productsRouter.use(requireAuth);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

interface CsvRow {
  name?: string;
  price?: string;
  material?: string;
  color?: string;
  size?: string;
  stock?: string;
  photo_url?: string;
}

productsRouter.get('/', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { merchantId: req.merchantId },
    orderBy: { createdAt: 'desc' },
  });

  const body: ProductListResponse = { products: products.map(toProductProfile) };
  res.json(body);
});

productsRouter.post('/upload-csv', csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'CSV file is required (field name: file)' });
    return;
  }

  let records: CsvRow[];
  try {
    records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      trim: true,
      skip_empty_lines: true,
    });
  } catch {
    res.status(400).json({ error: 'Could not parse CSV file' });
    return;
  }

  const merchantId = req.merchantId!;
  const errors: CsvUploadResponse['errors'] = [];
  const validRows: Array<{
    merchantId: string;
    name: string;
    price: number;
    material: string;
    color: string;
    sizeOptions: string[];
    stock: number;
    photoUrl: string;
    isAiReady: true;
    blocked: false;
  }> = [];

  records.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const name = row.name?.trim();
    const price = Number(row.price);
    const stock = row.stock ? Number(row.stock) : 0;

    if (!name) {
      errors.push({ row: rowNumber, message: 'Missing product name' });
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      errors.push({ row: rowNumber, message: `Invalid price "${row.price ?? ''}"` });
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      errors.push({ row: rowNumber, message: `Invalid stock "${row.stock ?? ''}"` });
      return;
    }

    validRows.push({
      merchantId,
      name,
      price,
      material: row.material?.trim() ?? '',
      color: row.color?.trim() ?? '',
      sizeOptions: parseSizeOptions(row.size),
      stock,
      photoUrl: row.photo_url?.trim() || placeholderPhotoUrl(`${merchantId}-${name}-${index}`),
      isAiReady: true,
      blocked: false,
    });
  });

  if (validRows.length > 0) {
    await prisma.product.createMany({ data: validRows });
  }

  const body: CsvUploadResponse = {
    created: validRows.length,
    skipped: errors.length,
    errors,
  };
  res.status(201).json(body);
});

productsRouter.post('/', imageUpload.single('photo'), async (req, res) => {
  const { name, material, color, size, photoUrl: photoUrlField } = req.body as Record<
    string,
    string | undefined
  >;
  const price = Number(req.body.price);
  const stock = req.body.stock ? Number(req.body.stock) : 0;

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!Number.isFinite(price) || price <= 0) {
    res.status(400).json({ error: 'price must be a positive number' });
    return;
  }
  if (!Number.isFinite(stock) || stock < 0) {
    res.status(400).json({ error: 'stock must be a non-negative number' });
    return;
  }

  const photoUrl = req.file
    ? `/uploads/${req.file.filename}`
    : photoUrlField?.trim() || placeholderPhotoUrl(`${req.merchantId}-${name}`);

  const product = await prisma.product.create({
    data: {
      merchantId: req.merchantId!,
      name: name.trim(),
      price,
      material: material?.trim() ?? '',
      color: color?.trim() ?? '',
      sizeOptions: parseSizeOptions(size),
      stock,
      photoUrl,
      isAiReady: true,
      blocked: false,
    },
  });

  const body: ProductResponse = { product: toProductProfile(product) };
  res.status(201).json(body);
});

productsRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, merchantId: req.merchantId },
  });
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const { price, stock, blocked } = req.body as UpdateProductRequest;
  const data: UpdateProductRequest = {};

  if (price !== undefined) {
    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'price must be a positive number' });
      return;
    }
    data.price = price;
  }
  if (stock !== undefined) {
    if (!Number.isFinite(stock) || stock < 0) {
      res.status(400).json({ error: 'stock must be a non-negative number' });
      return;
    }
    data.stock = stock;
  }
  if (blocked !== undefined) {
    if (typeof blocked !== 'boolean') {
      res.status(400).json({ error: 'blocked must be a boolean' });
      return;
    }
    data.blocked = blocked;
  }

  const product = await prisma.product.update({
    where: { id: existing.id },
    data,
  });

  const body: ProductResponse = { product: toProductProfile(product) };
  res.json(body);
});
