import type { Merchant, Product } from '@prisma/client';
import type {
  ActionType,
  StockStatus,
  StoreAiMatchedProduct,
  StoreAiAnswer,
} from '@ai-agent-storefront/shared';
import { getKeywordMatchResponse } from './keywordMatch';
import { generateGeminiContent } from './geminiClient';

export function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= 3) return 'low_stock';
  return 'in_stock';
}

interface CatalogEntry {
  id: string;
  name: string;
  price: number;
  material: string;
  color: string;
  size_options: string[];
  stock: number;
  stock_status: StockStatus;
}

function toCatalogEntry(product: Product): CatalogEntry {
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    material: product.material,
    color: product.color,
    size_options: product.sizeOptions,
    stock: product.stock,
    stock_status: stockStatus(product.stock),
  };
}

function buildSystemPrompt(merchant: Merchant, catalog: CatalogEntry[]): string {
  return [
    `You are the shopping assistant for "${merchant.name}", an Indian fashion storefront.`,
    'Answer the buyer strictly using the CATALOG JSON below. It is the complete and only real list of products this store currently sells.',
    '',
    'Rules:',
    '- Only recommend products that exist in this exact list. Never invent products, prices, sizes, or stock.',
    '- If there is no exact match for what the buyer asked for, pick the closest real alternative from CATALOG and set is_alternative to true; your message must explicitly say it is an alternative.',
    '- Never treat a product of a different garment type as an alternative or a match, even if its color/material match well (e.g. if the buyer asks for a saree and CATALOG has no sarees, do not suggest a kurta just because the color matches). If CATALOG has no item of the same garment type the buyer asked for, set matched_product to null.',
    '- If nothing in CATALOG is even a reasonable alternative, set matched_product to null and is_alternative to false.',
    '- This is a shopping agent, not a general catalog browser: treat any query that names or describes a specific product (even a bare phrase with no explicit "buy"/"order" wording) as an attempt to order it. Set action_type to "order_attempt" whenever you found a real match (exact or alternative) that is in_stock or low_stock.',
    '- Set action_type to "out_of_stock" when the buyer wants something matching a real catalog item whose stock_status is "out_of_stock".',
    '- Set action_type to "info_only" only for genuine browsing/general questions (e.g. "what do you sell?") or when there is no usable match at all (matched_product is null).',
    '- Every field you fill in for matched_product (id, name, price, photo_url, material, color, size_options, stock_status) must come verbatim from a single CATALOG entry with that id - never mix fields from different products and never make any up. photo_url is not present in CATALOG; leave it as an empty string, it will be filled in server-side.',
    '- Respond with a single JSON object matching the required response schema exactly. Do not include any text outside the JSON.',
    '',
    'CATALOG:',
    JSON.stringify(catalog),
  ].join('\n');
}

/**
 * Gemini's structured-output schema is a constrained subset of OpenAPI 3.0 -
 * no `anyOf`/`additionalProperties`, but `nullable` on a typed property is
 * supported, which is how matched_product's "no match" case is expressed.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['action_type', 'matched_product', 'is_alternative', 'message'],
  properties: {
    action_type: {
      type: 'STRING',
      enum: ['info_only', 'order_attempt', 'out_of_stock'],
    },
    matched_product: {
      type: 'OBJECT',
      nullable: true,
      required: ['id', 'name', 'price', 'photo_url', 'material', 'color', 'size_options', 'stock_status'],
      properties: {
        id: { type: 'STRING' },
        name: { type: 'STRING' },
        price: { type: 'NUMBER' },
        photo_url: { type: 'STRING' },
        material: { type: 'STRING' },
        color: { type: 'STRING' },
        size_options: { type: 'ARRAY', items: { type: 'STRING' } },
        stock_status: {
          type: 'STRING',
          enum: ['in_stock', 'low_stock', 'out_of_stock'],
        },
      },
    },
    is_alternative: { type: 'BOOLEAN' },
    message: { type: 'STRING' },
  },
};

interface RawToolOutput {
  action_type: ActionType;
  matched_product: { id: string } | null;
  is_alternative: boolean;
  message: string;
}

export interface StoreAiOutcome {
  result: StoreAiAnswer;
  hallucinationBlocked: boolean;
}

/**
 * Reconciles the model's raw tool output against the real catalog: only a
 * matched_product.id that exists in `products` is trusted. Every other field
 * of matched_product is rebuilt from our own DB record, never from the
 * model's output, so a hallucinated price/stock/photo can never reach the
 * client even if the model's id happens to be valid.
 */
export function reconcileWithCatalog(raw: RawToolOutput, products: Product[]): StoreAiOutcome {
  let matchedProduct: StoreAiMatchedProduct | null = null;
  let hallucinationBlocked = false;

  if (raw.matched_product) {
    const realProduct = products.find((p) => p.id === raw.matched_product?.id);
    if (realProduct) {
      matchedProduct = {
        id: realProduct.id,
        name: realProduct.name,
        price: realProduct.price.toString(),
        photo_url: realProduct.photoUrl,
        material: realProduct.material,
        color: realProduct.color,
        size_options: realProduct.sizeOptions,
        stock_status: stockStatus(realProduct.stock),
        stock: realProduct.stock,
      };
    } else {
      hallucinationBlocked = true;
    }
  }

  const actionType: ActionType =
    hallucinationBlocked && raw.action_type !== 'info_only' ? 'info_only' : raw.action_type;

  const message = hallucinationBlocked
    ? "I couldn't confirm that item in our current catalog, so I can't recommend it. Could you tell me more about what you're looking for?"
    : raw.message;

  return {
    result: {
      action_type: actionType,
      matched_product: matchedProduct,
      is_alternative: matchedProduct ? raw.is_alternative : false,
      message,
    },
    hallucinationBlocked,
  };
}

export async function getStoreAiResponse(params: {
  merchant: Merchant;
  products: Product[];
  buyerQuery: string;
}): Promise<StoreAiOutcome> {
  const { merchant, products, buyerQuery } = params;

  if (!process.env.GEMINI_API_KEY) {
    return reconcileWithCatalog(getKeywordMatchResponse({ merchant, products, buyerQuery }), products);
  }

  const catalog = products.map(toCatalogEntry);
  const system = buildSystemPrompt(merchant, catalog);

  // Gemini's free-tier quota and latency are both genuinely inconsistent in
  // practice (observed: rate limits, connection resets on slow "thinking"
  // responses). None of that should ever surface as a hard failure to a
  // buyer - fall back to the deterministic keyword matcher on any failure
  // here, exactly as if the key had never been configured.
  try {
    const text = await generateGeminiContent({
      systemInstruction: system,
      userText: buyerQuery,
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    });
    if (!text) throw new Error('Gemini returned an empty response');
    const parsed = JSON.parse(text) as RawToolOutput;
    return reconcileWithCatalog(parsed, products);
  } catch (err) {
    console.error('Gemini Store AI call failed, falling back to keyword matcher:', err);
    return reconcileWithCatalog(getKeywordMatchResponse({ merchant, products, buyerQuery }), products);
  }
}
