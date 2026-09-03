import { Router } from 'express';
import type { DirectoryResponse, MerchantDirectoryEntry } from '@ai-agent-storefront/shared';
import { detectGarmentType, normalizeGarmentType } from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';

export const directoryRouter = Router();

interface CandidateEntry {
  entry: MerchantDirectoryEntry;
  /** How many of this merchant's products satisfy both the category and budget filters — used to rank candidates, distinct from `productCount` (their total AI-ready catalog size). */
  matchingProductCount: number;
}

// Public: lets an AI shopping agent discover which merchants are AI-ready
// and relevant to a buyer's request, without already knowing a merchantId.
directoryRouter.get('/', async (req, res) => {
  const category = typeof req.query.category === 'string' ? normalizeGarmentType(req.query.category.toLowerCase()) : null;
  const maxBudget = typeof req.query.maxBudget === 'string' ? Number(req.query.maxBudget) : null;
  const hasBudgetFilter = maxBudget !== null && Number.isFinite(maxBudget);

  const merchants = await prisma.merchant.findMany({
    include: {
      products: { where: { isAiReady: true, blocked: false } },
    },
  });

  const candidates: CandidateEntry[] = [];

  for (const merchant of merchants) {
    if (merchant.products.length === 0) continue;

    const categories = Array.from(
      new Set(
        merchant.products
          .map((p) => detectGarmentType(p.name))
          .filter((c): c is string => c !== null),
      ),
    );

    const prices = merchant.products.map((p) => Number(p.price));
    const priceRange = { min: Math.min(...prices), max: Math.max(...prices) };

    const hasCategoryMatch = category === null || categories.includes(category);
    const hasBudgetMatch = !hasBudgetFilter || prices.some((p) => p <= (maxBudget as number));
    if (!hasCategoryMatch || !hasBudgetMatch) continue;

    const matchingProductCount = merchant.products.filter((p) => {
      const matchesCategory = category === null || detectGarmentType(p.name) === category;
      const matchesBudget = !hasBudgetFilter || Number(p.price) <= (maxBudget as number);
      return matchesCategory && matchesBudget;
    }).length;

    candidates.push({
      entry: {
        merchantId: merchant.id,
        storeName: merchant.name,
        categories,
        priceRange,
        productCount: merchant.products.length,
      },
      matchingProductCount,
    });
  }

  candidates.sort(
    (a, b) =>
      b.matchingProductCount - a.matchingProductCount || a.entry.priceRange.min - b.entry.priceRange.min,
  );

  const picked = candidates[0]?.entry ?? null;
  const pickedReason = picked
    ? candidates[0].matchingProductCount > 1
      ? `${candidates[0].matchingProductCount} matching products, the most of any AI-ready store`
      : 'lowest matching price among AI-ready stores'
    : null;

  await prisma.auditLog.create({
    data: {
      merchantId: picked?.merchantId ?? null,
      step: 'merchant_discovery',
      outcome: picked ? 'matched' : 'no_match',
      metadata: {
        category,
        maxBudget: hasBudgetFilter ? maxBudget : null,
        matchedMerchantId: picked?.merchantId ?? null,
        matchedMerchantName: picked?.storeName ?? null,
        totalCandidates: candidates.length,
      },
    },
  });

  const body: DirectoryResponse = {
    merchants: candidates.map((c) => c.entry),
    picked,
    pickedReason,
    totalCandidates: candidates.length,
  };
  res.json(body);
});
