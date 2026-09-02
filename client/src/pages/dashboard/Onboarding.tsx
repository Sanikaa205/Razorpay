import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AuthResponse, ConnectRazorpayAccountRequest, ProductListResponse } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../api/client';
import { useAuth } from '../../context/useAuth';
import { CsvUploadCard } from './catalog/CsvUploadCard';
import { AddProductForm } from './catalog/AddProductForm';

function StepBadge({ done, number }: { done: boolean; number: number }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        done ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'
      }`}
    >
      {done ? '✓' : number}
    </span>
  );
}

export default function Onboarding() {
  const { merchant, updateMerchant } = useAuth();
  const [razorpayAccountId, setRazorpayAccountId] = useState('');
  const [isSavingRazorpay, setIsSavingRazorpay] = useState(false);
  const [razorpayError, setRazorpayError] = useState<string | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);

  const loadProductCount = useCallback(() => {
    apiFetch<ProductListResponse>('/api/products')
      .then((data) => setProductCount(data.products.length))
      .catch(() => setProductCount(null));
  }, []);

  useEffect(() => {
    if (merchant?.razorpayAccountId) setRazorpayAccountId(merchant.razorpayAccountId);
  }, [merchant]);

  useEffect(() => {
    loadProductCount();
  }, [loadProductCount]);

  async function handleConnectRazorpay(e: FormEvent) {
    e.preventDefault();
    if (!razorpayAccountId.trim()) return;
    setIsSavingRazorpay(true);
    setRazorpayError(null);
    try {
      const payload: ConnectRazorpayAccountRequest = { razorpayAccountId: razorpayAccountId.trim() };
      const data = await apiFetch<AuthResponse>('/api/merchant/razorpay-account', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      updateMerchant(data.merchant);
    } catch (err) {
      setRazorpayError(err instanceof ApiError ? err.message : 'Could not save Razorpay account');
    } finally {
      setIsSavingRazorpay(false);
    }
  }

  const razorpayConnected = Boolean(merchant?.razorpayAccountId);
  const catalogReady = (productCount ?? 0) > 0;
  const allDone = razorpayConnected && catalogReady;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Onboarding</h1>
        <p className="mt-1 text-slate-500">
          Get your store ready for the AI shopping agent in three steps.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <StepBadge done number={1} />
          <div>
            <h2 className="font-semibold text-slate-900">Account created</h2>
            <p className="mt-1 text-sm text-slate-500">
              Signed in as <strong>{merchant?.name}</strong> ({merchant?.email}).
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <StepBadge done={razorpayConnected} number={2} />
          <div className="flex-1">
            <h2 className="font-semibold text-slate-900">Connect Razorpay (test mode)</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your Razorpay test account reference. Payments are processed with your
              account's Razorpay test-mode API keys configured on the server.
            </p>
            <form onSubmit={handleConnectRazorpay} className="mt-3 flex gap-2">
              <input
                value={razorpayAccountId}
                onChange={(e) => setRazorpayAccountId(e.target.value)}
                placeholder="e.g. acct_test_fashionhub"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={isSavingRazorpay || !razorpayAccountId.trim()}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSavingRazorpay ? 'Saving...' : razorpayConnected ? 'Update' : 'Connect'}
              </button>
            </form>
            {razorpayError && <p className="mt-2 text-sm text-red-600">{razorpayError}</p>}
            {razorpayConnected && (
              <p className="mt-2 text-sm text-green-700">
                Connected: {merchant?.razorpayAccountId}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <StepBadge done={catalogReady} number={3} />
          <div className="flex-1">
            <h2 className="font-semibold text-slate-900">Upload your first products</h2>
            <p className="mt-1 text-sm text-slate-500">
              {productCount === null
                ? 'Loading your catalog...'
                : `You currently have ${productCount} product${productCount === 1 ? '' : 's'}.`}
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <CsvUploadCard onUploaded={loadProductCount} />
              <AddProductForm onCreated={loadProductCount} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-600">
          {allDone
            ? 'All set! Share this link with buyers, or open it yourself to try the AI shopping agent:'
            : 'Finish the steps above, then share this link with buyers to try the AI shopping agent:'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-700">
            {window.location.origin}/store/{merchant?.id}
          </code>
          <a
            href={`/store/${merchant?.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Open storefront ↗
          </a>
          <Link
            to="/dashboard/catalog"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Go to Catalog
          </Link>
        </div>
      </div>
    </div>
  );
}
