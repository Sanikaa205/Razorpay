import Anthropic from '@anthropic-ai/sdk';
import type { CatalogField, CsvColumnMapping } from '@ai-agent-storefront/shared';

const MODEL_ID = 'claude-opus-5';
const TOOL_NAME = 'emit_column_mapping';

const CANONICAL_FIELDS: CatalogField[] = [
  'name',
  'price',
  'material',
  'color',
  'sizeOptions',
  'stock',
  'photoUrl',
];

const MAPPING_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Maps this spreadsheet\'s column headers onto the canonical catalog fields (name, price, material, color, sizeOptions, stock, photoUrl). Only map a field if some column genuinely represents it; otherwise omit that field.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: CANONICAL_FIELDS,
    properties: Object.fromEntries(
      CANONICAL_FIELDS.map((field) => [
        field,
        { anyOf: [{ type: 'string', description: 'exact source column header' }, { type: 'null' }] },
      ]),
    ),
  },
  strict: true,
};

/**
 * LLM-based column mapper — used instead of the rule-based synonym matcher
 * when ANTHROPIC_API_KEY is configured, for spreadsheets whose headers are
 * too unusual (abbreviations, non-English, inconsistent conventions) for
 * keyword matching to resolve confidently. Same swap pattern as
 * `getStoreAiResponse` falling back to `keywordMatch.ts`.
 */
export async function mapColumnsWithLlm(headers: string[]): Promise<CsvColumnMapping> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1000,
    system:
      'You map arbitrary product-spreadsheet column headers onto a fixed catalog schema. Only match a header to a field if it plausibly holds that data; never force a match.',
    tools: [MAPPING_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: `Column headers: ${JSON.stringify(headers)}` }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUse) throw new Error('LLM did not return a column mapping');

  const raw = toolUse.input as Record<CatalogField, string | null>;
  const mapping: CsvColumnMapping = {};
  for (const field of CANONICAL_FIELDS) {
    const sourceColumn = raw[field];
    if (sourceColumn && headers.includes(sourceColumn)) {
      mapping[field] = { sourceColumn, confidence: 1 };
    }
  }
  return mapping;
}
