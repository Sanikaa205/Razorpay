import type { Merchant, Product } from '@prisma/client';
import type { ActionType } from '@ai-agent-storefront/shared';
import { detectGarmentType, extractPriceCeiling, normalizeGarmentType } from '@ai-agent-storefront/shared';
import { stockStatus } from './storeAi';

interface RawToolOutput {
  action_type: ActionType;
  matched_product: { id: string } | null;
  is_alternative: boolean;
  message: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'do', 'you', 'have', 'has', 'is', 'are', 'i', 'want', 'need',
  'looking', 'for', 'me', 'my', 'in', 'of', 'with', 'and', 'or', 'to', 'under',
  'below', 'less', 'than', 'over', 'above', 'any', 'some', 'please', 'can',
  'it', 'that', 'this', 'one', 'get', 'find', 'show', 'like', 'would', 'size',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function overlapScore(queryTokens: string[], haystack: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    for (const ht of haystack) {
      if (ht === qt) {
        score += 2;
      } else if (ht.includes(qt) || qt.includes(ht)) {
        score += 1;
      }
    }
  }
  return score;
}

interface ProductScore {
  product: Product;
  nameScore: number;
  attrScore: number;
  attrCategoriesMatched: number;
  total: number;
}

/**
 * Splits the score into a "name" component (product type/description words —
 * e.g. "saree", "dress", "criss-cross") and separate material/color/size
 * attribute components. A single generic attribute word overlapping (e.g.
 * the query says "black" and some unrelated product happens to be black) is
 * not enough on its own to call something a real match — that's exactly the
 * kind of loose guess that would make the agent look like it's recommending
 * a product it never actually found. Requiring either some product-type
 * overlap, or overlap across at least two distinct attribute categories,
 * keeps a lone coincidental color match from being treated as a confident
 * hit.
 */
function scoreProduct(queryTokens: string[], product: Product): ProductScore {
  const nameTokens = tokenize(product.name);
  const materialTokens = tokenize(product.material);
  const colorTokens = tokenize(product.color);
  const sizeTokens = tokenize(product.sizeOptions.join(' '));

  const nameScore = overlapScore(queryTokens, nameTokens);
  const materialScore = overlapScore(queryTokens, materialTokens);
  const colorScore = overlapScore(queryTokens, colorTokens);
  const sizeScore = overlapScore(queryTokens, sizeTokens);

  const attrCategoriesMatched = [materialScore, colorScore, sizeScore].filter((s) => s > 0).length;
  const attrScore = materialScore + colorScore + sizeScore;

  return { product, nameScore, attrScore, attrCategoriesMatched, total: nameScore + attrScore };
}

function isValidCandidate(s: ProductScore): boolean {
  return s.nameScore > 0 || s.attrCategoriesMatched >= 2;
}

/**
 * Deterministic fallback for when no ANTHROPIC_API_KEY is configured: scores
 * buyer queries against the real catalog by keyword/token overlap (name,
 * material, color, size) plus an optional "under ₹X" price ceiling extracted
 * from the query. Never fabricates a product — the only candidates are real
 * `products` rows, and a query that scores 0 against everything returns no
 * match at all rather than guessing.
 */
export function getKeywordMatchResponse(params: {
  merchant: Merchant;
  products: Product[];
  buyerQuery: string;
}): RawToolOutput {
  const { products, buyerQuery } = params;
  const queryTokens = tokenize(buyerQuery);
  const priceCeiling = extractPriceCeiling(buyerQuery);

  // If the buyer named a specific garment type (saree, kurta, jacket, ...),
  // never let color/material overlap alone bridge across to a different
  // garment type — restrict candidates to the same type, or report no match
  // at all if the catalog doesn't carry that type. Without this, a query
  // like "red cotton saree" could return a "Red Cotton Kurta" as a confident
  // match purely because color and material happened to overlap.
  const queryType = detectGarmentType(buyerQuery);
  let candidateProducts = products;
  // Once restricted to one garment type, every candidate's name trivially
  // contains the type word (e.g. every candidate here is literally a
  // "saree"), so leaving it in `queryTokens` would make nameScore spuriously
  // positive for all of them regardless of color/material. Strip it so
  // nameScore only reflects genuine extra descriptive overlap.
  let scoringTokens = queryTokens;
  if (queryType) {
    const sameType = products.filter((p) => detectGarmentType(p.name) === queryType);
    if (sameType.length === 0) {
      return {
        action_type: 'info_only',
        matched_product: null,
        is_alternative: false,
        message: `We don't currently have any ${queryType}s in stock. Would you like to see something else we carry?`,
      };
    }
    candidateProducts = sameType;
    scoringTokens = queryTokens.filter((t) => normalizeGarmentType(t) !== queryType);
  }

  const scored = candidateProducts
    .map((p) => scoreProduct(scoringTokens, p))
    .filter((s) => queryType || isValidCandidate(s))
    .sort((a, b) => b.total - a.total || Number(a.product.price) - Number(b.product.price));

  if (scored.length === 0) {
    return {
      action_type: 'info_only',
      matched_product: null,
      is_alternative: false,
      message:
        "I couldn't find anything in our catalog matching that description. Could you try describing it differently, e.g. by type, color, or material?",
    };
  }

  const withinBudget = priceCeiling !== null
    ? scored.filter((s) => Number(s.product.price) <= priceCeiling)
    : scored;

  const bestEntry = (withinBudget.length > 0 ? withinBudget : scored)[0];
  const best = bestEntry.product;
  const status = stockStatus(best.stock);

  const overBudget = priceCeiling !== null && withinBudget.length === 0;
  // Within a category-gated result, a candidate with zero attribute overlap
  // matched purely on garment type (e.g. the only saree in stock, but not
  // the color/material the buyer asked for) — that's still worth surfacing,
  // but it must be labeled an alternative, never a confident exact match.
  const noAttributeOverlap = queryType !== null && bestEntry.attrScore === 0 && scoringTokens.length > 0;
  const isAlternative = overBudget || noAttributeOverlap;

  let message: string;
  if (overBudget) {
    message = `I don't have an exact match under ₹${priceCeiling}, but the closest real item I have is the ${best.name} at ₹${best.price}.`;
  } else if (noAttributeOverlap) {
    message = `I don't have a ${queryType} matching those exact details, but here's the ${queryType} I do have: ${best.name} (₹${best.price}, ${best.material}, ${best.color}).`;
  } else if (status === 'out_of_stock') {
    message = `The ${best.name} matches what you're looking for, but it's currently out of stock.`;
  } else {
    message = `Here's what I found: the ${best.name} (₹${best.price}, ${best.material}, ${best.color}).`;
  }

  const actionType: ActionType = status === 'out_of_stock' ? 'out_of_stock' : 'order_attempt';

  return {
    action_type: actionType,
    matched_product: { id: best.id },
    is_alternative: isAlternative,
    message,
  };
}
