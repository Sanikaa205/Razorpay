import { useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { OrderProfile, StoreAiQueryResponse } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError, resolveAssetUrl } from '../api/client';

type OrderUiState = 'idle' | 'submitting' | 'placed' | 'declined' | 'error';

interface ChatEntry {
  id: string;
  buyerQuery: string;
  response: StoreAiQueryResponse;
  orderState: OrderUiState;
  order?: OrderProfile;
  orderError?: string;
}

function stockStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function StorefrontChat() {
  const { merchantId } = useParams<{ merchantId: string }>();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const buyerQuery = query.trim();
    if (!buyerQuery || !merchantId) return;

    setIsLoading(true);
    setError(null);
    setQuery('');

    try {
      const response = await apiFetch<StoreAiQueryResponse>('/api/store-ai/query', {
        method: 'POST',
        body: JSON.stringify({ merchantId, buyerQuery }),
      });
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), buyerQuery, response, orderState: 'idle' },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmOrder(entry: ChatEntry) {
    if (!entry.response.matched_product) return;
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, orderState: 'submitting' } : e)),
    );
    try {
      const data = await apiFetch<{ order: OrderProfile }>('/api/orders/confirm', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: entry.response.conversationId,
          productId: entry.response.matched_product.id,
          userConfirmed: true,
        }),
      });
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
      </div>

      <div className="flex-1 space-y-4">
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-slate-900 px-4 py-2 text-sm text-white">
              {entry.buyerQuery}
            </div>

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
                    <img
                      src={resolveAssetUrl(entry.response.matched_product.photo_url)}
                      alt={entry.response.matched_product.name}
                      className="h-24 w-20 rounded object-cover"
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
                      <p className="mt-1 text-xs text-slate-400">
                        {stockStatusLabel(entry.response.matched_product.stock_status)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {entry.response.action_type === 'order_attempt' &&
                entry.response.matched_product &&
                entry.orderState === 'idle' && (
                  <div className="mt-3 flex gap-2">
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
                )}

              {entry.orderState === 'submitting' && (
                <p className="mt-2 text-sm text-slate-500">Placing order...</p>
              )}
              {entry.orderState === 'placed' && entry.order && (
                <p
                  className={`mt-2 text-sm font-medium ${
                    entry.order.status === 'auto_approved' ? 'text-green-700' : 'text-amber-700'
                  }`}
                >
                  {entry.order.status === 'auto_approved'
                    ? 'Order auto-approved!'
                    : 'Order placed — pending approval from the seller.'}
                </p>
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
        ))}

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
