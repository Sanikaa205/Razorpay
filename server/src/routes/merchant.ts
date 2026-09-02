import { Router } from 'express';
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
