import type { Merchant } from '@prisma/client';
import type { MerchantProfile } from '@ai-agent-storefront/shared';

export function toMerchantProfile(merchant: Merchant): MerchantProfile {
  return {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    razorpayAccountId: merchant.razorpayAccountId,
    // Both fields below are reserved for a future merchant manual-approval
    // feature - no route reads or writes them today (order approval uses a
    // fixed ₹1,000 customer-side threshold instead). Returned here only
    // because they're columns on the Merchant row.
    autoApproveLimit: merchant.autoApproveLimit.toString(),
    requireManualApproval: merchant.requireManualApproval,
    createdAt: merchant.createdAt.toISOString(),
  };
}
