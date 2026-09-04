import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type {
  ConfirmOrderResponse,
  DirectoryResponse,
  OrderProfile,
  StoreAiQueryResponse,
} from '@ai-agent-storefront/shared';
import { detectGarmentType, extractPriceCeiling } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../api/client';
import { ProductImage } from '../components/ProductImage';

type OrderUiState =
  | 'idle'
  | 'submitting'
  | 'needs_high_value_confirmation'
  | 'placed'
  | 'declined'
  | 'error';

interface ChatEntry {
  id: string;
  buyerQuery: string;
  response: StoreAiQueryResponse;
  orderState: OrderUiState;
  quantity: number;
  /** Defaults to the product's first real size option; undefined only for a "Free Size"-only product, which needs no choice. */
  selectedSize?: string;
  order?: OrderProfile;
  orderError?: string;
  paymentSubmitted?: boolean;
  highValuePrompt?: { orderValue: string; threshold: string };
  /** True when this entry's buyerQuery was already shown as a chat bubble by the discovery step that preceded it. */
  suppressBuyerBubble?: boolean;
}

interface DiscoveryNotice {
  buyerQuery: string;
  status: 'searching' | 'found' | 'no_match';
  text?: string;
}

// 'merchant_approved', 'pending_approval', and 'rejected' below (and in the
// status-message/color helpers further down) are reserved for a future
// merchant manual-approval feature - no order is ever created with them
// today (every order is auto_approved), kept so this page handles them
// correctly without a code change if that feature ships later.
const TERMINAL_STATUSES: OrderProfile['status'][] = ['paid', 'failed', 'rejected'];
const PAYABLE_STATUSES: OrderProfile['status'][] = ['auto_approved', 'merchant_approved', 'failed'];
const BUYER_SESSION_KEY = 'ai-agent-storefront:buyer-session-id';

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/**
 * Opens Razorpay's embedded Checkout widget against an already-created
 * Razorpay order - no Payment Link involved, so this isn't subject to test
 * mode's much lower daily limit on Payment Link creation. The webhook (not
 * this success handler) is still the source of truth for whether the order
 * actually reaches "paid" - this just gives the buyer immediate feedback
 * that the payment was submitted.
 */
function openRazorpayCheckout(params: {
  razorpayOrderId: string;
  amountPaise: number;
  productName: string;
  onSubmitted: () => void;
}) {
  if (!window.Razorpay) {
    alert('Payment could not start - please reload the page and try again.');
    return;
  }
  const rzp = new window.Razorpay({
    key: import.meta.env.VITE_RAZORPAY_KEY_ID,
    amount: params.amountPaise,
    currency: 'INR',
    name: params.productName,
    order_id: params.razorpayOrderId,
    theme: { color: '#0f172a' },
    handler: () => params.onSubmitted(),
  });
  rzp.open();
}

/** A stable per-browser-tab-session id for this buyer/agent - not a real identity, just enough for the merchant dashboard to tell separate sessions apart. */
function getBuyerSessionId(): string {
  let id = sessionStorage.getItem(BUYER_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(BUYER_SESSION_KEY, id);
  }
  return id;
}

function stockStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function orderStatusMessage(status: OrderProfile['status']): string {
  switch (status) {
    case 'auto_approved':
      return 'Order auto-approved! Complete your payment below.';
    case 'pending_approval':
      return 'Order placed — pending approval from the seller.';
    case 'merchant_approved':
      return 'Order approved by the seller! Complete your payment below.';
    case 'rejected':
      return 'Order was rejected by the seller.';
    case 'paid':
      return 'Payment successful — your order is confirmed!';
    case 'failed':
      return 'Payment failed. You can try again below.';
    default:
      return '';
  }
}

function orderStatusColor(status: OrderProfile['status']): string {
  if (status === 'paid' || status === 'auto_approved' || status === 'merchant_approved') {
    return 'text-green-700';
  }
  if (status === 'failed' || status === 'rejected') {
    return 'text-red-700';
  }
  return 'text-amber-700';
}

export default function StorefrontChat() {
  const { merchantId: routeMerchantId } = useParams<{ merchantId: string }>();
  const [resolvedMerchantId, setResolvedMerchantId] = useState<string | undefined>(routeMerchantId);
  const [discoveryNotice, setDiscoveryNotice] = useState<DiscoveryNotice | null>(null);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entriesRef = useRef<ChatEntry[]>([]);
  const buyerSessionIdRef = useRef<string>('');

  useEffect(() => {
    buyerSessionIdRef.current = getBuyerSessionId();
  }, []);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // Poll orders that are still awaiting a payment webhook so the buyer sees
  // paid/failed show up automatically once Razorpay notifies the server.
  useEffect(() => {
    const interval = setInterval(async () => {
      const inFlight = entriesRef.current.filter(
        (e) => e.order && !TERMINAL_STATUSES.includes(e.order.status),
      );
      if (inFlight.length === 0) return;

      const updates = await Promise.all(
        inFlight.map(async (e) => {
          try {
            const data = await apiFetch<{ order: OrderProfile }>(`/api/orders/${e.order!.id}`);
            return { entryId: e.id, order: data.order };
          } catch {
            return null;
          }
        }),
      );

      setEntries((prev) =>
        prev.map((e) => {
          const update = updates.find((u) => u && u.entryId === e.id);
          // A failed payment should let the buyer retry via the Pay button
          // again, rather than staying stuck on "waiting for confirmation".
          const paymentSubmitted = update?.order.status === 'failed' ? false : e.paymentSubmitted;
          return update ? { ...e, order: update.order, paymentSubmitted } : e;
        }),
      );
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const buyerQuery = query.trim();
    if (!buyerQuery) return;

    setIsLoading(true);
    setError(null);
    setQuery('');

    let targetMerchantId = resolvedMerchantId;
    let suppressBuyerBubble = false;

    // No merchant scoped yet (arrived via the generic /store entry point,
    // not a merchant's own /store/:merchantId link) — discover one before
    // ever calling a specific merchant's Store AI.
    if (!targetMerchantId) {
      setDiscoveryNotice({ buyerQuery, status: 'searching' });
      try {
        const category = detectGarmentType(buyerQuery);
        const maxBudget = extractPriceCeiling(buyerQuery);
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (maxBudget !== null) params.set('maxBudget', String(maxBudget));

        const directory = await apiFetch<DirectoryResponse>(`/api/directory?${params.toString()}`);

        if (!directory.picked) {
          setDiscoveryNotice({
            buyerQuery,
            status: 'no_match',
            text: 'No AI-ready merchants found for this yet. Try describing it differently, or a different budget.',
          });
          setIsLoading(false);
          return;
        }

        targetMerchantId = directory.picked.merchantId;
        setResolvedMerchantId(targetMerchantId);
        suppressBuyerBubble = true;
        const { storeName, categories, priceRange } = directory.picked;
        setDiscoveryNotice({
          buyerQuery,
          status: 'found',
          text: `Found: ${storeName} — ${categories.join(', ')}, ₹${priceRange.min}–${priceRange.max} (picked: ${directory.pickedReason}).`,
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not search AI-ready merchants');
        setIsLoading(false);
        return;
      }
    }

    try {
      const response = await apiFetch<StoreAiQueryResponse>('/api/store-ai/query', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: targetMerchantId,
          buyerQuery,
          buyerSessionId: buyerSessionIdRef.current,
        }),
      });
      const sizeOptions = response.matched_product?.size_options ?? [];
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          buyerQuery,
          response,
          orderState: 'idle',
          quantity: 1,
          selectedSize: sizeOptions.length > 1 ? sizeOptions[0] : undefined,
          suppressBuyerBubble,
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }

  function setQuantity(entryId: string, quantity: number) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, quantity } : e)));
  }

  function setSelectedSize(entryId: string, selectedSize: string) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, selectedSize } : e)));
  }

  async function confirmOrder(entry: ChatEntry, highValueConfirmed = false) {
    if (!entry.response.matched_product) return;
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, orderState: 'submitting' } : e)),
    );
    try {
      const data = await apiFetch<ConfirmOrderResponse>('/api/orders/confirm', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: entry.response.conversationId,
          productId: entry.response.matched_product.id,
          userConfirmed: true,
          quantity: entry.quantity,
          selectedSize: entry.selectedSize,
          highValueConfirmed,
        }),
      });
      if ('requiresHighValueConfirmation' in data) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  orderState: 'needs_high_value_confirmation',
                  highValuePrompt: { orderValue: data.orderValue, threshold: data.threshold },
                }
              : e,
          ),
        );
        return;
      }
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, orderState: 'placed', order: data.order } : e,
        ),
      );
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? {
                ...e,
                orderState: 'error',
                orderError: err instanceof ApiError ? err.message : 'Could not place the order',
              }
            : e,
        ),
      );
    }
  }

  function declineOrder(entryId: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, orderState: 'declined' } : e)),
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-slate-50 px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI Shopping Assistant</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ask about products in natural language — sizes, colors, prices, availability.
        </p>
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>What&apos;s real vs. simulated:</strong> the catalog, AI matching, order
          decisions, and Razorpay payments below are fully live — this page just stands in for a
          buyer&apos;s device on a real storefront, with no separate checkout flow of its own.
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {discoveryNotice && (
          <div className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-slate-900 px-4 py-2 text-sm text-white">
              {discoveryNotice.buyerQuery}
            </div>
            <div className="max-w-[90%] rounded-lg rounded-tl-none border border-slate-200 bg-white p-4">
              {discoveryNotice.status === 'searching' && (
                <p className="text-sm text-slate-500">Searching AI-ready merchants…</p>
              )}
              {discoveryNotice.status === 'found' && (
                <p className="text-sm text-slate-700">{discoveryNotice.text}</p>
              )}
              {discoveryNotice.status === 'no_match' && (
                <p className="text-sm text-red-600">{discoveryNotice.text}</p>
              )}
            </div>
          </div>
        )}

        {entries.map((entry) => {
          const stock = entry.response.matched_product?.stock ?? 0;
          const outOfStock = stock <= 0;
          return (
          <div key={entry.id} className="space-y-2">
            {!entry.suppressBuyerBubble && (
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-slate-900 px-4 py-2 text-sm text-white">
                {entry.buyerQuery}
              </div>
            )}

            <div className="max-w-[90%] rounded-lg rounded-tl-none border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-700">{entry.response.message}</p>

              {entry.response.matched_product && (
                <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-3">
                  {entry.response.is_alternative && (
                    <span className="mb-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                      Closest match
                    </span>
                  )}
                  <div className="flex gap-3">
                    <ProductImage
                      src={entry.response.matched_product.photo_url}
                      alt={entry.response.matched_product.name}
                      className="h-24 w-20 rounded"
                    />
                    <div>
                      <p className="font-semibold text-slate-900">
                        {entry.response.matched_product.name}
                      </p>
                      <p className="text-slate-700">₹{entry.response.matched_product.price}</p>
                      <p className="text-sm text-slate-500">
                        {[
                          entry.response.matched_product.material,
                          entry.response.matched_product.color,
                          entry.response.matched_product.size_options.join('/'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p
                        className={`mt-1 text-xs ${outOfStock ? 'font-medium text-red-600' : 'text-slate-400'}`}
                      >
                        {outOfStock
                          ? 'Out of stock'
                          : `${stockStatusLabel(entry.response.matched_product.stock_status)} · ${stock} available`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {entry.response.action_type === 'order_attempt' &&
                entry.response.matched_product &&
                entry.orderState === 'idle' &&
                (outOfStock ? (
                  <p className="mt-3 text-sm font-medium text-red-600">
                    This item is currently out of stock and can't be ordered.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {entry.response.matched_product.size_options.length > 1 && (
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        Size
                        <select
                          value={entry.selectedSize}
                          onChange={(e) => setSelectedSize(entry.id, e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                        >
                          {entry.response.matched_product.size_options.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      Qty
                      <input
                        type="number"
                        min={1}
                        max={stock}
                        value={entry.quantity}
                        onChange={(e) => {
                          const next = Math.max(1, Math.min(stock, Number(e.target.value) || 1));
                          setQuantity(entry.id, next);
                        }}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <button
                      onClick={() => confirmOrder(entry)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Confirm order
                    </button>
                    <button
                      onClick={() => declineOrder(entry.id)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      No, show something else
                    </button>
                  </div>
                ))}

              {entry.orderState === 'submitting' && (
                <p className="mt-2 text-sm text-slate-500">Placing order...</p>
              )}
              {entry.orderState === 'needs_high_value_confirmation' && entry.highValuePrompt && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    This order is ₹{entry.highValuePrompt.orderValue}, above the ₹
                    {entry.highValuePrompt.threshold} auto-approve threshold. Please confirm you
                    want to proceed with this purchase.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => confirmOrder(entry, true)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Yes, proceed with this order
                    </button>
                    <button
                      onClick={() => declineOrder(entry.id)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {entry.orderState === 'placed' && entry.order && (
                <div className="mt-2 space-y-2">
                  <p className={`text-sm font-medium ${orderStatusColor(entry.order.status)}`}>
                    {orderStatusMessage(entry.order.status)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.order.selectedSize && `Size ${entry.order.selectedSize} · `}
                    Qty {entry.order.quantity} · Order total ₹{entry.order.orderValue}
                  </p>
                  {entry.order.razorpayOrderId &&
                    PAYABLE_STATUSES.includes(entry.order.status) &&
                    (entry.paymentSubmitted ? (
                      <p className="text-sm text-slate-500">
                        Payment submitted — waiting for confirmation...
                      </p>
                    ) : (
                      <button
                        onClick={() =>
                          openRazorpayCheckout({
                            razorpayOrderId: entry.order!.razorpayOrderId!,
                            amountPaise: Math.round(Number(entry.order!.orderValue) * 100),
                            productName: entry.response.matched_product?.name ?? 'Order',
                            onSubmitted: () => {
                              setEntries((prev) =>
                                prev.map((e) =>
                                  e.id === entry.id ? { ...e, paymentSubmitted: true } : e,
                                ),
                              );
                            },
                          })
                        }
                        className="inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Pay ₹{entry.order.orderValue} with Razorpay
                      </button>
                    ))}
                </div>
              )}
              {entry.orderState === 'declined' && (
                <p className="mt-2 text-sm text-slate-500">
                  No problem — tell me what else you're looking for.
                </p>
              )}
              {entry.orderState === 'error' && (
                <p className="mt-2 text-sm text-red-600">{entry.orderError}</p>
              )}
            </div>
          </div>
          );
        })}

        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="sticky bottom-4 mt-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Do you have a red saree under 1500?"
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isLoading ? 'Asking...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
