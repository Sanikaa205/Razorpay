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

  await prisma.order.update({
    where: { id: order.id },
    data: { status: newStatus, razorpayPaymentId: payment.id },
  });

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
