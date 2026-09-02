import type { Merchant } from '@prisma/client';
import type { MerchantProfile } from '@ai-agent-storefront/shared';

export function toMerchantProfile(merchant: Merchant): MerchantProfile {
  return {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    razorpayAccountId: merchant.razorpayAccountId,
    autoApproveLimit: merchant.autoApproveLimit.toString(),
    requireManualApproval: merchant.requireManualApproval,
    createdAt: merchant.createdAt.toISOString(),
  };
}
