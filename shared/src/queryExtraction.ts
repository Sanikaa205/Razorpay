/**
 * Lightweight, dependency-free extraction of a garment category and a price
 * ceiling from a buyer's free-text query. Shared between the server's
 * keyword-based Store AI fallback and the client's merchant-discovery step,
 * so both layers agree on what a query like "sky blue dress under 800"
 * actually means without duplicating the rules in two languages.
 */

export const GARMENT_TYPES = [
  'saree', 'sari', 'kurta', 'kurti', 'dress', 'jacket', 'gown', 'lehenga', 'salwar',
  'palazzo', 'jeans', 'skirt', 'scarf', 'jumpsuit', 'top', 'shirt', 'blouse', 'coat',
  'cardigan', 'sweater', 'shrug',
];

export function normalizeGarmentType(type: string): string {
  return type === 'sari' ? 'saree' : type;
}

function simpleTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹.\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** The specific garment type a query or product name mentions, e.g. "saree" — null if none of the known types is mentioned. */
export function detectGarmentType(text: string): string | null {
  const tokens = simpleTokenize(text);
  for (const type of GARMENT_TYPES) {
    if (tokens.includes(type)) return normalizeGarmentType(type);
  }
  return null;
}

/** "under ₹800", "below 500", "max 1200" -> 800 / 500 / 1200. Null if the query names no ceiling. */
export function extractPriceCeiling(query: string): number | null {
  const match = query.match(/(?:under|below|less than|max(?:imum)?|budget of)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i)
    || query.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(?:or less|max|budget)/i);
  return match ? Number(match[1]) : null;
}
