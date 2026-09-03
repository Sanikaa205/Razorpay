import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type {
  CsvColumnMapping,
  CsvFieldFlag,
  CsvPreviewRow,
  TransformedProductFields,
} from '@ai-agent-storefront/shared';
import { placeholderPhotoUrl } from './product';

export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses an uploaded .csv, .xlsx, or .xls buffer into header + row data, regardless of format. */
export function parseSpreadsheet(buffer: Buffer, filename: string): ParsedSpreadsheet {
  const isExcel = /\.xlsx?$/i.test(filename);

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw: false,
    });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows };
  }

  const records = parse(buffer.toString('utf-8'), {
    columns: true,
    trim: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

// --- Value normalizers -----------------------------------------------------

/** "₹1,499", "Rs. 899", "INR 2,499.00", "1299" -> 1499 / 899 / 2499 / 1299. */
export function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "In Stock", "5 pcs left", "Out of Stock", "12", "" -> a numeric stock count plus how confident we are. */
export function parseStock(raw: string | undefined): { value: number; inferred: boolean } {
  const text = (raw ?? '').trim();
  if (!text) return { value: 0, inferred: true };

  const numberMatch = text.match(/(\d+)/);
  if (numberMatch) return { value: Number(numberMatch[1]), inferred: false };

  if (/out\s*of\s*stock|unavailable|sold\s*out|^no$/i.test(text)) {
    return { value: 0, inferred: false };
  }
  if (/in\s*stock|available|^yes$/i.test(text)) {
    return { value: 10, inferred: true };
  }
  return { value: 0, inferred: true };
}

/** "Red / Blue", "S, M, L", "Red/Green/Blue" -> ["Red","Blue"] / ["S","M","L"] / [...]. */
export function parseMultiValue(raw: string | undefined): string[] {
  if (!raw) return [];
  const values = raw
    .split(/[,/|]/)
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

const MATERIAL_DICTIONARY = [
  'banarasi silk', 'kanjivaram silk', 'tussar silk', 'handloom cotton', 'cotton blend',
  'cotton silk', 'chikankari', 'georgette', 'chiffon', 'linen', 'denim', 'lycra', 'rayon',
  'crepe', 'polyester', 'velvet', 'wool', 'nylon', 'satin', 'khadi', 'muslin', 'jute',
  'mesh', 'silk', 'cotton',
];

const COLOR_DICTIONARY = [
  'sky blue', 'navy blue', 'royal blue', 'light blue', 'dark blue', 'mustard yellow',
  'emerald green', 'olive green', 'rust orange', 'indigo blue', 'hot pink', 'off white',
  'red', 'blue', 'green', 'black', 'white', 'yellow', 'pink', 'purple', 'orange', 'beige',
  'maroon', 'teal', 'peach', 'coral', 'gold', 'silver', 'brown', 'grey', 'gray', 'indigo',
  'mustard', 'emerald', 'olive', 'rust', 'navy', 'cream', 'ivory', 'magenta', 'turquoise', 'lavender',
];

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Finds the first (longest-phrase-first) dictionary term appearing in a product name, e.g. for inferring color/material when there's no dedicated column. */
function findInDictionary(name: string, dictionary: string[]): string | null {
  const lower = name.toLowerCase();
  for (const term of dictionary) {
    const pattern = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(lower)) return titleCase(term);
  }
  return null;
}

export function inferMaterialFromName(name: string): string | null {
  return findInDictionary(name, MATERIAL_DICTIONARY);
}

export function inferColorFromName(name: string): string | null {
  return findInDictionary(name, COLOR_DICTIONARY);
}

const DIRECT_IMAGE_URL = /^https?:\/\/.+\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$/i;
const KNOWN_IMAGE_HOSTS = /(picsum\.photos|images\.unsplash\.com|res\.cloudinary\.com|cloudinary\.com|imgur\.com|githubusercontent\.com|s3[.\-][a-z0-9-]*\.amazonaws\.com|amazonaws\.com|images-amazon\.com|shopify\.com|cdn\.)/i;

/**
 * Heuristic check for whether a URL is likely a *direct* image file rather
 * than a page that merely contains an image (a Google Drive "view" link, a
 * marketplace product page, a Pinterest pin). Not a guarantee either way —
 * the frontend's onError fallback is what actually keeps the UI safe — but
 * this lets the upload preview warn the merchant about a likely-bad link
 * before it ever reaches a buyer.
 */
export function isLikelyDirectImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return DIRECT_IMAGE_URL.test(url) || KNOWN_IMAGE_HOSTS.test(url);
}

// --- Row transformation ------------------------------------------------------

function getMapped(row: Record<string, string>, mapping: CsvColumnMapping, field: keyof CsvColumnMapping): string | undefined {
  const column = mapping[field]?.sourceColumn;
  return column ? row[column]?.trim() : undefined;
}

/**
 * Transforms one raw spreadsheet row into our internal product schema: maps
 * columns per `mapping`, cleans/normalizes values, and infers material/color
 * from the product name when no dedicated column supplied them. Anything
 * that couldn't be confidently derived is recorded as a flag rather than
 * silently guessed, and a row missing a truly required field (name, price)
 * is marked invalid so it's excluded from the save.
 */
export function transformRow(
  raw: Record<string, string>,
  mapping: CsvColumnMapping,
  rowNumber: number,
  seedForPhoto: string,
): CsvPreviewRow {
  const flags: CsvFieldFlag[] = [];

  const name = getMapped(raw, mapping, 'name') ?? '';
  if (!name) {
    flags.push({ field: 'name', severity: 'error', message: 'No product name could be found for this row.' });
  }

  const rawPrice = getMapped(raw, mapping, 'price');
  const price = parsePrice(rawPrice);
  if (price === null) {
    flags.push({
      field: 'price',
      severity: 'error',
      message: rawPrice ? `Could not parse a price from "${rawPrice}".` : 'No price column was detected for this row.',
    });
  }

  let material = getMapped(raw, mapping, 'material') ?? '';
  if (!material && name) {
    const inferred = inferMaterialFromName(name);
    if (inferred) {
      material = inferred;
      flags.push({ field: 'material', severity: 'info', message: `Material inferred from product name as "${inferred}".` });
    } else {
      flags.push({ field: 'material', severity: 'warning', message: 'No material column found and none could be inferred from the name.' });
    }
  }

  let color = getMapped(raw, mapping, 'color') ?? '';
  if (!color && name) {
    const inferred = inferColorFromName(name);
    if (inferred) {
      color = inferred;
      flags.push({ field: 'color', severity: 'info', message: `Color inferred from product name as "${inferred}".` });
    } else {
      flags.push({ field: 'color', severity: 'warning', message: 'No color column found and none could be inferred from the name.' });
    }
  }

  const rawSize = getMapped(raw, mapping, 'sizeOptions');
  let sizeOptions = parseMultiValue(rawSize);
  if (sizeOptions.length === 0) {
    sizeOptions = ['Free Size'];
    flags.push({ field: 'sizeOptions', severity: 'info', message: 'No size column found; defaulted to "Free Size".' });
  }

  const rawStock = getMapped(raw, mapping, 'stock');
  const { value: stock, inferred: stockInferred } = parseStock(rawStock);
  if (stockInferred) {
    flags.push({
      field: 'stock',
      severity: 'warning',
      message: rawStock
        ? `Could not read an exact quantity from "${rawStock}"; estimated ${stock}.`
        : `No stock column was detected; defaulted to ${stock}.`,
    });
  }

  let photoUrl = getMapped(raw, mapping, 'photoUrl') ?? '';
  if (!photoUrl) {
    photoUrl = placeholderPhotoUrl(seedForPhoto);
    flags.push({ field: 'photoUrl', severity: 'info', message: 'No image column found; using a placeholder photo.' });
  } else if (!isLikelyDirectImageUrl(photoUrl)) {
    flags.push({
      field: 'photoUrl',
      severity: 'warning',
      message: 'This image link may be a page link rather than a direct file link and might not display — the storefront will fall back to a placeholder if it fails to load.',
    });
  }

  const transformed: TransformedProductFields = { name, price, material, color, sizeOptions, stock, photoUrl };
  const valid = !flags.some((f) => f.severity === 'error');

  return { rowNumber, raw, transformed, flags, valid };
}
