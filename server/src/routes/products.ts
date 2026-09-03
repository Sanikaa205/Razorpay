import path from 'path';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import type {
  CsvConfirmRequest,
  CsvPreviewResponse,
  CsvUploadResponse,
  ProductListResponse,
  ProductResponse,
  UpdateProductRequest,
} from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { UPLOADS_DIR } from '../lib/uploads';
import { parseSizeOptions, placeholderPhotoUrl, toProductProfile } from '../lib/product';
import { mapColumns } from '../lib/csvColumnMapping';
import { parseSpreadsheet, transformRow } from '../lib/csvTransform';

export const productsRouter = Router();

productsRouter.use(requireAuth);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

productsRouter.get('/', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { merchantId: req.merchantId },
    orderBy: { createdAt: 'desc' },
  });

  const body: ProductListResponse = { products: products.map(toProductProfile) };
  res.json(body);
});

/**
 * Phase 1 of the messy-CSV pipeline: parses any CSV/Excel file (arbitrary
 * column names/order), auto-maps its columns onto our schema, and returns a
 * per-row before/after transformation preview. Nothing is saved yet — the
 * merchant reviews this in the UI and explicitly confirms via /upload-csv/confirm.
 */
productsRouter.post('/upload-csv/preview', csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'A CSV or Excel file is required (field name: file)' });
    return;
  }

  let parsed;
  try {
    parsed = parseSpreadsheet(req.file.buffer, req.file.originalname);
  } catch {
    res.status(400).json({ error: 'Could not parse this file. Please upload a valid CSV or Excel file.' });
    return;
  }

  if (parsed.rows.length === 0) {
    res.status(400).json({ error: 'No data rows were found in this file.' });
    return;
  }

  const merchantId = req.merchantId!;
  const { mapping, source } = await mapColumns(parsed.headers);

  const rows = parsed.rows.map((row, index) =>
    transformRow(row, mapping, index + 2, `${merchantId}-preview-${index}-${Date.now()}`),
  );

  const body: CsvPreviewResponse = {
    detectedColumns: parsed.headers,
    columnMapping: mapping,
    mappingSource: source,
    rows,
  };
  res.json(body);
});

/**
 * Phase 2: the merchant has reviewed the before/after preview and confirmed.
 * Saves the already-transformed rows (each still paired with its original
 * raw row, persisted as Product.rawData for traceability), skipping any row
 * the preview marked invalid (missing name/price it couldn't recover).
 */
productsRouter.post('/upload-csv/confirm', async (req, res) => {
  const { rows } = req.body as Partial<CsvConfirmRequest>;
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'rows is required' });
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
    rawData: Record<string, string>;
  }> = [];

  rows.forEach(({ raw, transformed }, index) => {
    const rowNumber = index + 2;
    const name = transformed?.name?.trim();
    const price = transformed?.price;

    if (!name) {
      errors.push({ row: rowNumber, message: 'Missing product name' });
      return;
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      errors.push({ row: rowNumber, message: 'Missing or invalid price' });
      return;
    }

    validRows.push({
      merchantId,
      name,
      price,
      material: transformed.material?.trim() ?? '',
      color: transformed.color?.trim() ?? '',
      sizeOptions: parseSizeOptions(transformed.sizeOptions?.join(',')),
      stock: Number.isFinite(transformed.stock) ? transformed.stock : 0,
      photoUrl: transformed.photoUrl?.trim() || placeholderPhotoUrl(`${merchantId}-${name}-${index}`),
      isAiReady: true,
      blocked: false,
      rawData: raw ?? {},
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
