import Anthropic from '@anthropic-ai/sdk';
import type { Merchant, Product } from '@prisma/client';
import type {
  ActionType,
  StockStatus,
  StoreAiMatchedProduct,
  StoreAiAnswer,
} from '@ai-agent-storefront/shared';

const MODEL_ID = 'claude-opus-5';
const RESPONSE_TOOL_NAME = 'emit_store_response';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

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
    '- If nothing in CATALOG is even a reasonable alternative, set matched_product to null and is_alternative to false.',
    '- Set action_type to "order_attempt" when the buyer is trying to buy/order a specific product and you found a real match that is in_stock or low_stock.',
    '- Set action_type to "out_of_stock" when the buyer wants something matching a real catalog item whose stock_status is "out_of_stock".',
    '- Set action_type to "info_only" for browsing, general questions, or when there is no usable match at all.',
    '- Every field you fill in for matched_product (id, name, price, photo_url, material, color, size_options, stock_status) must come verbatim from a single CATALOG entry with that id - never mix fields from different products and never make any up. photo_url is not present in CATALOG; leave it as an empty string, it will be filled in server-side.',
    '- Call the emit_store_response tool exactly once with your answer.',
    '',
    'CATALOG:',
    JSON.stringify(catalog),
  ].join('\n');
}

const RESPONSE_TOOL: Anthropic.Tool = {
  name: RESPONSE_TOOL_NAME,
  description:
    "Return the structured answer for the buyer's query, grounded strictly in the CATALOG provided in the system prompt.",
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action_type', 'matched_product', 'is_alternative', 'message'],
    properties: {
      action_type: {
        type: 'string',
        enum: ['info_only', 'order_attempt', 'out_of_stock'],
      },
      matched_product: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'name',
              'price',
              'photo_url',
              'material',
              'color',
              'size_options',
              'stock_status',
            ],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              price: { type: 'number' },
              photo_url: { type: 'string' },
              material: { type: 'string' },
              color: { type: 'string' },
              size_options: { type: 'array', items: { type: 'string' } },
              stock_status: {
                type: 'string',
                enum: ['in_stock', 'low_stock', 'out_of_stock'],
              },
            },
          },
          { type: 'null' },
        ],
      },
      is_alternative: { type: 'boolean' },
      message: { type: 'string' },
    },
  },
  strict: true,
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
  const catalog = products.map(toCatalogEntry);
  const system = buildSystemPrompt(merchant, catalog);

  const response = await getClient().messages.create({
    model: MODEL_ID,
    max_tokens: 2000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [RESPONSE_TOOL],
    tool_choice: { type: 'tool', name: RESPONSE_TOOL_NAME },
    messages: [{ role: 'user', content: buyerQuery }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUse) {
    return {
      result: {
        action_type: 'info_only',
        matched_product: null,
        is_alternative: false,
        message: "Sorry, I couldn't process that request right now. Please try again.",
      },
      hallucinationBlocked: false,
    };
  }

  return reconcileWithCatalog(toolUse.input as RawToolOutput, products);
}
