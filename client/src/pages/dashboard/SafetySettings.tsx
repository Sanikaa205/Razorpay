import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AuthResponse,
  MerchantSettingsRequest,
  ProductListResponse,
  ProductProfile,
} from '@ai-agent-storefront/shared';
import { apiFetch, ApiError, resolveAssetUrl } from '../../api/client';
import { useAuth } from '../../context/useAuth';

export default function SafetySettings() {
  const { merchant, updateMerchant } = useAuth();
  const [autoApproveLimit, setAutoApproveLimit] = useState('0');
  const [requireManualApproval, setRequireManualApproval] = useState(false);
  const [products, setProducts] = useState<ProductProfile[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (merchant) {
      setAutoApproveLimit(merchant.autoApproveLimit);
      setRequireManualApproval(merchant.requireManualApproval);
    }
  }, [merchant]);

  useEffect(() => {
    apiFetch<ProductListResponse>('/api/products')
      .then((data) => {
        setProducts(data.products);
        setBlockedIds(new Set(data.products.filter((p) => p.blocked).map((p) => p.id)));
      })
      .catch(() => setError('Failed to load products'))
      .finally(() => setIsLoading(false));
  }, []);

  function toggleBlocked(productId: string) {
    setBlockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    const limit = Number(autoApproveLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      setError('Auto-approve limit must be a non-negative number');
      return;
    }

    setIsSaving(true);
    try {
      const payload: MerchantSettingsRequest = {
        autoApproveLimit: limit,
        requireManualApproval,
        blockedProductIds: Array.from(blockedIds),
      };
      const data = await apiFetch<AuthResponse>('/api/merchant/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      updateMerchant(data.merchant);
      setProducts((prev) => prev.map((p) => ({ ...p, blocked: blockedIds.has(p.id) })));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Safety Settings</h1>
        <p className="mt-1 text-slate-500">
          Control how much autonomy the AI agent has when placing orders.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Approval rules</h2>

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="autoApproveLimit">
            Auto-approve orders under (₹)
          </label>
          <input
            id="autoApproveLimit"
            type="number"
            min="0"
            step="0.01"
            value={autoApproveLimit}
            onChange={(e) => setAutoApproveLimit(e.target.value)}
            className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Orders at or below this value are approved automatically, unless manual approval is
            required below.
          </p>

          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={requireManualApproval}
              onChange={(e) => setRequireManualApproval(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Require manual approval for every order, regardless of value
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Blocked products</h2>
          <p className="mt-1 text-sm text-slate-500">
            Blocked products are never recommended or sold by the AI agent.
          </p>

          {isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No products in your catalog yet.</p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {products.map((product) => (
                <label
                  key={product.id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={blockedIds.has(product.id)}
                    onChange={() => toggleBlocked(product.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <img
                    src={resolveAssetUrl(product.photoUrl)}
                    alt={product.name}
                    className="h-10 w-8 rounded object-cover"
                  />
                  <span className="flex-1 truncate">{product.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {savedAt && <p className="text-sm text-green-700">Settings saved.</p>}

        <button
          type="submit"
          disabled={isSaving || isLoading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
