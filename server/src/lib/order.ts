import type { Order } from '@prisma/client';
import type { OrderProfile } from '@ai-agent-storefront/shared';

export function toOrderProfile(order: Order): OrderProfile {
  return {
    id: order.id,
    merchantId: order.merchantId,
    productId: order.productId,
    conversationId: order.conversationId,
    quantity: order.quantity,
    selectedSize: order.selectedSize,
    orderValue: order.orderValue.toString(),
    status: order.status,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    razorpayPaymentLinkId: order.razorpayPaymentLinkId,
    razorpayPaymentLinkUrl: order.razorpayPaymentLinkUrl,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
