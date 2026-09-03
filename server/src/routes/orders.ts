import { Router } from 'express';
import type {
  ConfirmOrderRequest,
  ConfirmOrderResponse,
  OrderListResponse,
  OrderResponse,
} from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { toOrderProfile } from '../lib/order';
import { createPaymentForOrder } from '../lib/payment';

export const ordersRouter = Router();

/**
 * Orders at or below this value proceed straight to payment once the buyer
 * confirms. Orders above it need a second, explicit confirmation from the
 * buyer first (see /confirm below) - this is a customer-side safety check,
 * not a merchant-review gate, and applies the same way to every merchant.
 */
const CUSTOMER_APPROVAL_THRESHOLD = 1000;

// Protected: the merchant's own order list, for the dashboard's Payments and
// Live Orders screens. merchantId is always taken from the session, never
// from the query string, so a merchant can never list another store's orders.
ordersRouter.get('/', requireAuth, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { merchantId: req.merchantId },
    include: { product: true, conversation: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });

  const body: OrderListResponse = {
    orders: orders.map((order) => ({
      ...toOrderProfile(order),
      productName: order.product.name,
      productPhotoUrl: order.product.photoUrl,
      productStock: order.product.stock,
      buyerSessionId: order.conversation?.buyerSessionId ?? null,
      buyerType: order.conversation?.buyerType ?? null,
      buyerQuery: order.conversation?.buyerQuery ?? null,
    })),
  };
  res.json(body);
});

// Public: the buyer explicitly confirming an order they were shown by the Store AI.
// No merchant session exists here - the buyer isn't a logged-in merchant.
ordersRouter.post('/confirm', async (req, res) => {
  const { conversationId, productId, userConfirmed, quantity, selectedSize, highValueConfirmed } =
    req.body as Partial<ConfirmOrderRequest>;

  if (userConfirmed !== true) {
    res.status(400).json({ error: 'Order must be explicitly confirmed by the buyer' });
    return;
  }
  if (!conversationId || !productId) {
    res.status(400).json({ error: 'conversationId and productId are required' });
    return;
  }
  const orderQuantity = Number.isInteger(quantity) && (quantity as number) > 0 ? (quantity as number) : 1;

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

  // A product with only one size ("Free Size" or any single option) doesn't
  // need the buyer to pick anything; anything else requires an explicit,
  // real choice from that exact product's own sizeOptions - never a size
  // the product doesn't actually offer.
  let finalSize: string | null = null;
  if (product.sizeOptions.length <= 1) {
    finalSize = product.sizeOptions[0] ?? null;
  } else if (typeof selectedSize === 'string' && product.sizeOptions.includes(selectedSize)) {
    finalSize = selectedSize;
  } else {
    res.status(400).json({
      error: 'Please select a size',
      sizeOptions: product.sizeOptions,
    });
    return;
  }

  // Stock is only ever deducted once a payment actually succeeds (see the
  // webhook handler), but we still must not let a buyer start an order for
  // more units than currently exist - this is the point-of-order-creation
  // guard against that, independent of the Store AI's own out-of-stock
  // labeling (which could be stale if two buyers query around the same time).
  if (product.stock <= 0) {
    res.status(409).json({ error: 'This product is out of stock' });
    return;
  }
  if (orderQuantity > product.stock) {
    res.status(409).json({ error: `Only ${product.stock} unit(s) of this product are available` });
    return;
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: conversation.merchantId } });
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const orderValue = Math.round(Number(product.price) * orderQuantity * 100) / 100;
  const overThreshold = orderValue > CUSTOMER_APPROVAL_THRESHOLD;

  // Orders over the threshold need a second, explicit confirmation from the
  // buyer before an order is even created - a customer-side safety check
  // (are you sure about this larger purchase?), not a merchant-review gate.
  if (overThreshold && highValueConfirmed !== true) {
    const body: ConfirmOrderResponse = {
      requiresHighValueConfirmation: true,
      orderValue: orderValue.toString(),
      threshold: String(CUSTOMER_APPROVAL_THRESHOLD),
    };
    res.status(200).json(body);
    return;
  }

  const order = await prisma.order.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      conversationId: conversation.id,
      quantity: orderQuantity,
      selectedSize: finalSize,
      orderValue,
      status: 'auto_approved',
    },
  });

  await prisma.auditLog.create({
    data: {
      merchantId: merchant.id,
      orderId: order.id,
      step: 'order_confirmation',
      outcome: 'auto_approved',
      metadata: {
        reason: overThreshold
          ? `Order value ₹${orderValue} exceeds the ₹${CUSTOMER_APPROVAL_THRESHOLD} customer-approval threshold, but the buyer explicitly confirmed the purchase.`
          : `Order value ₹${orderValue} is within the ₹${CUSTOMER_APPROVAL_THRESHOLD} auto-approve threshold.`,
        productName: product.name,
        quantity: orderQuantity,
        selectedSize: finalSize,
        orderValue: orderValue.toString(),
        buyerSessionId: conversation.buyerSessionId,
        buyerType: conversation.buyerType,
      },
    },
  });

  const finalOrder = await createPaymentForOrder(order.id);

  const body: ConfirmOrderResponse = { order: toOrderProfile(finalOrder) };
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
