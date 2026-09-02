import { Router } from 'express';
import type { StoreAiQueryRequest, StoreAiQueryResponse } from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { getStoreAiResponse } from '../lib/storeAi';

export const storeAiRouter = Router();

storeAiRouter.post('/query', async (req, res) => {
  const { merchantId, buyerQuery } = req.body as Partial<StoreAiQueryRequest>;

  if (!merchantId || !buyerQuery?.trim()) {
    res.status(400).json({ error: 'merchantId and buyerQuery are required' });
    return;
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const products = await prisma.product.findMany({
    where: { merchantId, isAiReady: true, blocked: false },
  });

  let outcome;
  try {
    outcome = await getStoreAiResponse({ merchant, products, buyerQuery });
  } catch (err) {
    await prisma.auditLog.create({
      data: {
        merchantId,
        step: 'store_ai_query',
        outcome: 'error',
        metadata: { buyerQuery, error: err instanceof Error ? err.message : String(err) },
      },
    });
    res.status(502).json({ error: 'Store AI request failed' });
    return;
  }

  const { result, hallucinationBlocked } = outcome;

  const conversation = await prisma.conversation.create({
    data: {
      merchantId,
      buyerQuery,
      storeAiResponse: JSON.stringify(result),
      actionType: result.action_type,
    },
  });

  await prisma.auditLog.create({
    data: {
      merchantId,
      step: 'store_ai_query',
      outcome: hallucinationBlocked ? 'hallucination_blocked' : 'success',
      metadata: {
        buyerQuery,
        actionType: result.action_type,
        matchedProductId: result.matched_product?.id ?? null,
        isAlternative: result.is_alternative,
      },
    },
  });

  const body: StoreAiQueryResponse = { ...result, conversationId: conversation.id };
  res.json(body);
});
