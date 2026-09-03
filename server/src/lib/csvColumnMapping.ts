import type { CatalogField, CsvColumnMapping } from '@ai-agent-storefront/shared';

const CANONICAL_FIELDS: CatalogField[] = [
  'name',
  'price',
  'material',
  'color',
  'sizeOptions',
  'stock',
  'photoUrl',
];

/**
 * Synonyms a real merchant's spreadsheet might use for each canonical field.
 * Order doesn't matter — matching is by normalized token overlap, not order.
 */
const SYNONYMS: Record<CatalogField, string[]> = {
  name: ['name', 'productname', 'producttitle', 'title', 'itemname', 'item', 'product', 'productdescription'],
  price: ['price', 'mrp', 'cost', 'rate', 'sellingprice', 'amount', 'unitprice', 'listprice', 'priceinr'],
  material: ['material', 'fabric', 'fabrictype', 'cloth', 'textile', 'fabricmaterial'],
  color: ['color', 'colour', 'shade', 'colorway'],
  sizeOptions: ['size', 'sizes', 'sizeoptions', 'availablesizes', 'availablesize', 'sizerange'],
  stock: ['stock', 'qty', 'quantity', 'qtyavailable', 'availableqty', 'inventory', 'units', 'stockqty', 'unitsavailable', 'stocklevel'],
  photoUrl: ['photo', 'photourl', 'image', 'imageurl', 'img', 'picture', 'pictureurl', 'imagelink'],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Score of how well a normalized header matches one canonical field's synonym list, 0-1. */
function fieldScore(normalizedHeader: string, field: CatalogField): number {
  let best = 0;
  for (const syn of SYNONYMS[field]) {
    if (normalizedHeader === syn) return 1;
    if (normalizedHeader.includes(syn) || syn.includes(normalizedHeader)) {
      best = Math.max(best, 0.85);
      continue;
    }
    const distance = levenshtein(normalizedHeader, syn);
    const maxLen = Math.max(normalizedHeader.length, syn.length);
    const similarity = maxLen === 0 ? 0 : 1 - distance / maxLen;
    if (similarity > 0.72) best = Math.max(best, similarity * 0.8);
  }
  return best;
}

/**
 * Rule-based synonym/keyword column mapper — the fallback used when no LLM
 * key is configured. For each canonical catalog field, picks the source
 * header with the highest synonym-match score (exact match, substring
 * containment, then edit-distance fuzzy match, in that priority order), and
 * never assigns the same source column to two different fields. This keeps
 * the mapper deterministic and dependency-free, mirroring how
 * `keywordMatch.ts` stands in for Store AI when Claude isn't available.
 */
export function mapColumnsRuleBased(headers: string[]): CsvColumnMapping {
  const normalized = headers.map((h) => ({ header: h, normalized: normalizeHeader(h) }));
  const mapping: CsvColumnMapping = {};
  const usedHeaders = new Set<string>();

  const candidates: Array<{ field: CatalogField; header: string; score: number }> = [];
  for (const field of CANONICAL_FIELDS) {
    for (const { header, normalized: n } of normalized) {
      const score = fieldScore(n, field);
      if (score > 0) candidates.push({ field, header, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const MIN_SCORE = 0.55;
  for (const candidate of candidates) {
    if (candidate.score < MIN_SCORE) continue;
    if (mapping[candidate.field]) continue;
    if (usedHeaders.has(candidate.header)) continue;
    mapping[candidate.field] = { sourceColumn: candidate.header, confidence: candidate.score };
    usedHeaders.add(candidate.header);
  }

  return mapping;
}

export async function mapColumns(
  headers: string[],
): Promise<{ mapping: CsvColumnMapping; source: 'llm' | 'rule_based' }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { mapping: mapColumnsRuleBased(headers), source: 'rule_based' };
  }

  try {
    const { mapColumnsWithLlm } = await import('./csvColumnMappingLlm');
    const mapping = await mapColumnsWithLlm(headers);
    return { mapping, source: 'llm' };
  } catch {
    return { mapping: mapColumnsRuleBased(headers), source: 'rule_based' };
  }
}
