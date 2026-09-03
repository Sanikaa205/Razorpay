import { prisma } from '../prisma';
import { getRazorpayClient } from './razorpay';
import type { Order } from '@prisma/client';

/**
 * Creates the Razorpay order for an already-approved Order and persists the
 * resulting id. Never throws - a Razorpay API failure is logged to AuditLog
 * and the Order is returned unchanged, so an approval decision (auto or
 * manual) is never rolled back just because the payment provider call
 * failed; the merchant can retry payment creation separately.
 *
 * This only creates a Razorpay Order, not a Payment Link - the buyer pays
 * via Razorpay's embedded Checkout widget client-side (using this order id
 * directly), which isn't subject to test mode's separate, much lower daily
 * limit on Payment Link creation.
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

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        razorpayOrderId: razorpayOrder.id,
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
        metadata: {
          error:
            err instanceof Error
              ? err.message
              : (() => {
                  try {
                    return JSON.stringify(err);
                  } catch {
                    return String(err);
                  }
                })(),
          amountPaise,
        },
      },
    });
    return order;
  }
}
