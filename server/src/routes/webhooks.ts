import crypto from 'crypto';
import { Router } from 'express';
import { prisma } from '../prisma';
import { getRazorpayClient } from '../lib/razorpay';

export const webhooksRouter = Router();

interface RazorpayWebhookPayload {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        status: string;
      };
    };
  };
}

webhooksRouter.post('/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Invalid webhook request' });
    return;
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(req.body).digest('hex');

  const signatureValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!signatureValid) {
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  let event: RazorpayWebhookPayload;
  try {
    event = JSON.parse(req.body.toString('utf-8')) as RazorpayWebhookPayload;
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  const payment = event.payload?.payment?.entity;
  const isCaptured = event.event === 'payment.captured';
  const isFailed = event.event === 'payment.failed';

  if (!payment || (!isCaptured && !isFailed)) {
    res.status(200).json({ received: true });
    return;
  }

  const order = await prisma.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
  if (!order) {
    res.status(200).json({ received: true });
    return;
  }

  const newStatus = isCaptured ? 'paid' : 'failed';
  // Tracks what actually happened to the order, for the final audit log
  // below - distinct from `newStatus` (what this event nominally means),
  // since an oversold order gets flipped back to 'failed' after initially
  // being marked 'paid' by the claim above.
  let finalOutcome: string = newStatus;

  // `stockDeducted` is both the "has this order already been finalized"
  // guard and the stock-deduction marker. It's flipped via an atomic
  // conditional update (WHERE stockDeducted = false) rather than a
  // read-then-write, so that two near-simultaneous deliveries of the same
  // webhook (Razorpay's delivery is at-least-once, so retries happen) can
  // never both pass the guard - only the request whose UPDATE actually
  // matches the row (claimed.count === 1) proceeds to touch stock at all.
  if (isCaptured) {
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, stockDeducted: false },
      data: {
        status: newStatus,
        razorpayPaymentId: payment.id,
        paidAt: new Date(),
        stockDeducted: true,
      },
    });

    if (claimed.count === 1) {
      // Atomic conditional decrement: only succeeds if enough stock is
      // still there right now, in the same statement that checks it - no
      // separate read-then-decrement gap for a concurrent order on the same
      // product to race through. If two buyers both bought the last unit,
      // whichever webhook's UPDATE commits second here affects 0 rows
      // instead of driving stock negative.
      const decremented = await prisma.$executeRaw`
        UPDATE "products" SET "stock" = "stock" - ${order.quantity}
        WHERE "id" = ${order.productId} AND "stock" >= ${order.quantity}
      `;

      if (decremented === 0) {
        // Genuinely oversold: this payment captured for a unit that no
        // longer exists. The charge already succeeded on Razorpay's side,
        // so the order cannot be left standing as "paid" - refund it and
        // mark it failed instead of silently keeping the buyer's money for
        // something that can't be fulfilled.
        await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } });
        finalOutcome = 'failed';

        try {
          await getRazorpayClient().payments.refund(payment.id, {
            amount: Math.round(Number(order.orderValue) * 100),
          });
          await prisma.auditLog.create({
            data: {
              merchantId: order.merchantId,
              orderId: order.id,
              step: 'stock_updated',
              outcome: 'oversold_refunded',
              metadata: {
                productId: order.productId,
                quantityRequested: order.quantity,
                reason: 'Payment captured after stock ran out; automatically refunded',
              },
            },
          });
        } catch (err) {
          await prisma.auditLog.create({
            data: {
              merchantId: order.merchantId,
              orderId: order.id,
              step: 'stock_updated',
              outcome: 'oversold_refund_failed',
              metadata: {
                productId: order.productId,
                quantityRequested: order.quantity,
                error: err instanceof Error ? err.message : String(err),
              },
            },
          });
        }
      } else {
        await prisma.auditLog.create({
          data: {
            merchantId: order.merchantId,
            orderId: order.id,
            step: 'stock_updated',
            outcome: 'decremented',
            metadata: {
              productId: order.productId,
              quantityDeducted: order.quantity,
              reason: 'Order payment captured',
            },
          },
        });
      }
    }
  } else {
    await prisma.order.updateMany({
      where: { id: order.id, stockDeducted: false },
      data: { status: newStatus, razorpayPaymentId: payment.id },
    });
  }

  await prisma.auditLog.create({
    data: {
      merchantId: order.merchantId,
      orderId: order.id,
      step: 'payment_status_updated',
      outcome: finalOutcome,
      metadata: {
        event: event.event,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id,
      },
    },
  });

  res.status(200).json({ received: true });
});
