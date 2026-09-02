import { useState } from 'react';
import type { FormEvent } from 'react';
import type { StoreAiQueryResponse } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../api/client';
import { useAuth } from '../../context/useAuth';

const SAMPLE_QUERIES = [
  'Do you have a red kurta in size M?',
  'I want to order the Banarasi Silk Saree',
  'Do you have a leather biker jacket in size XXL under ₹200?',
  'What sarees do you have under 1500 rupees?',
];

export default function StoreAiTest() {
  const { merchant } = useAuth();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<StoreAiQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runQuery(buyerQuery: string) {
    if (!merchant) return;
    setIsLoading(true);
    setError(null);
    setResponse(null);
    try {
      const data = await apiFetch<StoreAiQueryResponse>('/api/store-ai/query', {
        method: 'POST',
        body: JSON.stringify({ merchantId: merchant.id, buyerQuery }),
      });
      setResponse(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) runQuery(query.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Store AI Test (Internal)</h1>
        <p className="mt-1 text-slate-500">
          Send a raw buyer query to the Store AI service and inspect the exact JSON it returns.
          Use this to verify answers stay grounded in the real catalog, including cases with no
          real match.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a buyer query, e.g. 'Do you have a blue saree under 1000?'"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isLoading ? 'Asking...' : 'Send query'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_QUERIES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => {
                setQuery(sample);
                runQuery(sample);
              }}
              disabled={isLoading}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {response && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              action_type: {response.action_type}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              is_alternative: {String(response.is_alternative)}
            </span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                response.matched_product
                  ? 'bg-green-100 text-green-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              matched_product: {response.matched_product ? response.matched_product.id : 'null'}
            </span>
          </div>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
