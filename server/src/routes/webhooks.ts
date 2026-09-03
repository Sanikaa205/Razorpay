import crypto from 'crypto';
import { Router } from 'express';
import { prisma } from '../prisma';

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

  // Stock is deducted exactly once, exactly here - the only point an order
  // has genuinely converted to money. It is never touched on order creation,
  // approval, or while a payment is merely pending, and a failed payment
  // never decrements it at all (nothing to "roll back" since it was never
  // touched). `stockDeducted` guards against a retried/duplicate webhook
  // delivery double-deducting the same order.
  if (isCaptured && !order.stockDeducted) {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: newStatus,
          razorpayPaymentId: payment.id,
          paidAt: new Date(),
          stockDeducted: true,
        },
      }),
      prisma.product.update({
        where: { id: order.productId },
        data: { stock: { decrement: order.quantity } },
      }),
    ]);

    // Stock can't go negative even under a race with another concurrent
    // order (the DB decrement above is atomic per-row, but two orders could
    // each pass their own point-of-creation stock check moments apart) -
    // clamp it back to zero rather than let the count read as negative.
    const product = await prisma.product.findUnique({ where: { id: order.productId } });
    if (product && product.stock < 0) {
      await prisma.product.update({ where: { id: product.id }, data: { stock: 0 } });
    }

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
  } else if (!order.stockDeducted) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: newStatus, razorpayPaymentId: payment.id },
    });
  }

  await prisma.auditLog.create({
    data: {
      merchantId: order.merchantId,
      orderId: order.id,
      step: 'payment_status_updated',
      outcome: newStatus,
      metadata: {
        event: event.event,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id,
      },
    },
  });

  res.status(200).json({ received: true });
});
