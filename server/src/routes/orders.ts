import { Router } from 'express';
import type {
  ConfirmOrderRequest,
  OrderListResponse,
  OrderResponse,
} from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { toOrderProfile } from '../lib/order';
import { createPaymentForOrder } from '../lib/payment';

export const ordersRouter = Router();

// Protected: the merchant's own order list, for the dashboard's Payments and
// Live Orders screens. merchantId is always taken from the session, never
// from the query string, so a merchant can never list another store's orders.
ordersRouter.get('/', requireAuth, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { merchantId: req.merchantId },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
  });

  const body: OrderListResponse = {
    orders: orders.map((order) => ({
      ...toOrderProfile(order),
      productName: order.product.name,
      productPhotoUrl: order.product.photoUrl,
    })),
  };
  res.json(body);
});

// Public: the buyer explicitly confirming an order they were shown by the Store AI.
// No merchant session exists here - the buyer isn't a logged-in merchant.
ordersRouter.post('/confirm', async (req, res) => {
  const { conversationId, productId, userConfirmed } = req.body as Partial<ConfirmOrderRequest>;

  if (userConfirmed !== true) {
    res.status(400).json({ error: 'Order must be explicitly confirmed by the buyer' });
    return;
  }
  if (!conversationId || !productId) {
    res.status(400).json({ error: 'conversationId and productId are required' });
    return;
  }

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, merchantId: conversation.merchantId },
  });
  if (!product) {
    res.status(404).json({ error: "Product not found in this conversation's store" });
    return;
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: conversation.merchantId } });
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const orderValue = product.price;
  const underLimit = Number(orderValue) <= Number(merchant.autoApproveLimit);
  const status = !merchant.requireManualApproval && underLimit ? 'auto_approved' : 'pending_approval';

  const order = await prisma.order.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      conversationId: conversation.id,
      orderValue,
      status,
    },
  });

  const reason =
    status === 'auto_approved'
      ? `Order value ₹${orderValue.toString()} is within the auto-approve limit of ₹${merchant.autoApproveLimit.toString()} and manual approval is not required.`
      : merchant.requireManualApproval
        ? 'Merchant requires manual approval for all orders.'
        : `Order value ₹${orderValue.toString()} exceeds the auto-approve limit of ₹${merchant.autoApproveLimit.toString()}.`;

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      orderId: order.id,
      step: 'order_confirmation',
      outcome: status,
      metadata: {
        reason,
        productName: product.name,
        orderValue: orderValue.toString(),
        autoApproveLimit: merchant.autoApproveLimit.toString(),
        requireManualApproval: merchant.requireManualApproval,
      },
    },
  });

  const finalOrder = status === 'auto_approved' ? await createPaymentForOrder(order.id) : order;

  const body: OrderResponse = { order: toOrderProfile(finalOrder) };
  res.status(201).json(body);
});

// Public: lets the buyer's page poll for status changes (e.g. after a webhook
// updates the order to paid/failed) without a merchant session.
ordersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  const body: OrderResponse = { order: toOrderProfile(order) };
  res.json(body);
});

// Protected: the merchant manually approving/rejecting an order pending their review.
ordersRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, merchantId: req.merchantId },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (order.status !== 'pending_approval') {
    res.status(400).json({ error: `Order is not pending approval (status: ${order.status})` });
    return;
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'merchant_approved' },
  });

  await prisma.auditLog.create({
    data: {
      merchantId: order.merchantId,
      orderId: order.id,
      step: 'order_approval',
      outcome: 'merchant_approved',
      metadata: { reason: 'Manually approved by merchant', previousStatus: order.status },
    },
  });

  const finalOrder = await createPaymentForOrder(updated.id);

  const body: OrderResponse = { order: toOrderProfile(finalOrder) };
  res.json(body);
});

ordersRouter.post('/:id/reject', requireAuth, async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, merchantId: req.merchantId },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (order.status !== 'pending_approval') {
    res.status(400).json({ error: `Order is not pending approval (status: ${order.status})` });
    return;
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'rejected' },
  });

  await prisma.auditLog.create({
    data: {
      merchantId: order.merchantId,
      orderId: order.id,
      step: 'order_approval',
      outcome: 'rejected',
      metadata: { reason: 'Manually rejected by merchant', previousStatus: order.status },
    },
  });

  const body: OrderResponse = { order: toOrderProfile(updated) };
  res.json(body);
});
