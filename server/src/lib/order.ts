import type { Order } from '@prisma/client';
import type { OrderProfile } from '@ai-agent-storefront/shared';

export function toOrderProfile(order: Order): OrderProfile {
  return {
    id: order.id,
    merchantId: order.merchantId,
    productId: order.productId,
    conversationId: order.conversationId,
    orderValue: order.orderValue.toString(),
    status: order.status,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    razorpayPaymentLinkId: order.razorpayPaymentLinkId,
    razorpayPaymentLinkUrl: order.razorpayPaymentLinkUrl,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
