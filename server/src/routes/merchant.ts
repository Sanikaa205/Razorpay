import { Router } from 'express';
import type {
  AuthResponse,
  ConnectRazorpayAccountRequest,
  MerchantSettingsRequest,
} from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { toMerchantProfile } from '../lib/merchant';
import { requireAuth } from '../middleware/auth';

export const merchantRouter = Router();

merchantRouter.use(requireAuth);

merchantRouter.get('/me', async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.merchantId } });
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }
  res.json({ merchant: toMerchantProfile(merchant) });
});

merchantRouter.patch('/settings', async (req, res) => {
  const { autoApproveLimit, requireManualApproval, blockedProductIds } =
    req.body as Partial<MerchantSettingsRequest>;

  if (typeof autoApproveLimit !== 'number' || !Number.isFinite(autoApproveLimit) || autoApproveLimit < 0) {
    res.status(400).json({ error: 'autoApproveLimit must be a non-negative number' });
    return;
  }
  if (typeof requireManualApproval !== 'boolean') {
    res.status(400).json({ error: 'requireManualApproval must be a boolean' });
    return;
  }
  const blockedIds = Array.isArray(blockedProductIds) ? blockedProductIds : [];

  const merchant = await prisma.merchant.update({
    where: { id: req.merchantId },
    data: { autoApproveLimit, requireManualApproval },
  });

  await prisma.$transaction([
    prisma.product.updateMany({
      where: { merchantId: req.merchantId, id: { in: blockedIds } },
      data: { blocked: true },
    }),
    prisma.product.updateMany({
      where: { merchantId: req.merchantId, id: { notIn: blockedIds } },
      data: { blocked: false },
    }),
  ]);

  const body: AuthResponse = { merchant: toMerchantProfile(merchant) };
  res.json(body);
});

merchantRouter.patch('/razorpay-account', async (req, res) => {
  const { razorpayAccountId } = req.body as Partial<ConnectRazorpayAccountRequest>;

  if (typeof razorpayAccountId !== 'string' || !razorpayAccountId.trim()) {
    res.status(400).json({ error: 'razorpayAccountId is required' });
    return;
  }

  const merchant = await prisma.merchant.update({
    where: { id: req.merchantId },
    data: { razorpayAccountId: razorpayAccountId.trim() },
  });

  const body: AuthResponse = { merchant: toMerchantProfile(merchant) };
  res.json(body);
});
