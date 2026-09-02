import { prisma } from '../prisma';
import { getRazorpayClient } from './razorpay';
import type { Order } from '@prisma/client';

/**
 * Creates the Razorpay order + payment link for an already-approved Order and
 * persists the resulting ids/URL. Never throws - a Razorpay API failure is
 * logged to AuditLog and the Order is returned unchanged, so an approval
 * decision (auto or manual) is never rolled back just because the payment
 * provider call failed; the merchant can retry payment creation separately.
 */
export async function createPaymentForOrder(orderId: string): Promise<Order> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const [product, merchant] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { id: order.productId } }),
    prisma.merchant.findUniqueOrThrow({ where: { id: order.merchantId } }),
  ]);

  const amountPaise = Math.round(Number(order.orderValue) * 100);

  try {
    const client = getRazorpayClient();

    const razorpayOrder = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: order.id,
      notes: { orderId: order.id, merchantId: merchant.id, productId: product.id },
    });

    const paymentLink = await client.paymentLink.create({
      amount: amountPaise,
      currency: 'INR',
      description: `${product.name} - ${merchant.name}`,
      reference_id: order.id,
      customer: {
        name: 'Storefront Buyer',
        email: 'buyer@example.com',
        contact: '9999999999',
      },
      notify: { sms: false, email: false },
      notes: { orderId: order.id },
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        razorpayOrderId: razorpayOrder.id,
        razorpayPaymentLinkId: paymentLink.id,
        razorpayPaymentLinkUrl: paymentLink.short_url,
      },
    });

    await prisma.auditLog.create({
      data: {
        merchantId: order.merchantId,
        orderId: order.id,
        step: 'payment_created',
        outcome: 'success',
        metadata: {
          razorpayOrderId: razorpayOrder.id,
          paymentLinkId: paymentLink.id,
          amountPaise,
        },
      },
    });

    return updated;
  } catch (err) {
    await prisma.auditLog.create({
      data: {
        merchantId: order.merchantId,
        orderId: order.id,
        step: 'payment_created',
        outcome: 'error',
        metadata: { error: err instanceof Error ? err.message : String(err), amountPaise },
      },
    });
    return order;
  }
}
