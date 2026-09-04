import { useCallback, useEffect, useState } from 'react';
import type { OrderListResponse, OrderWithProduct } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../api/client';
import { ProductImage } from '../../components/ProductImage';

// merchant_approved, pending_approval, and rejected are reserved for a
// future merchant manual-approval feature and no order is ever created with
// them today (every order is auto_approved) - kept here so this table
// renders correctly without a code change if that feature ships later.
const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  auto_approved: 'bg-blue-100 text-blue-800',
  merchant_approved: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-red-100 text-red-800',
};

const AWAITING_PAYMENT_STATUSES = ['auto_approved', 'merchant_approved', 'pending_approval'];
const POLL_INTERVAL_MS = 5000;

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function Payments() {
  const [orders, setOrders] = useState<OrderWithProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    return apiFetch<OrderListResponse>('/api/orders')
      .then((data) => {
        setOrders(data.orders);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load orders'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // Every figure here comes straight from real Order rows in the database -
  // never a placeholder or estimate. Revenue in particular only ever counts
  // orders whose payment actually captured (status === 'paid'), so a pending
  // or failed payment can never inflate it.
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const failedOrders = orders.filter((o) => o.status === 'failed');
  const awaitingPayment = orders.filter((o) => AWAITING_PAYMENT_STATUSES.includes(o.status));
  const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.orderValue), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="mt-1 text-slate-500">
          Every order and its Razorpay payment status, updated live.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total revenue</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            ₹{totalRevenue.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-xs text-slate-400">from real successful payments only</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Paid orders</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{paidOrders.length}</p>
          <p className="mt-1 text-xs text-slate-400">of {orders.length} total orders</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Pending payments</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{awaitingPayment.length}</p>
          <p className="mt-1 text-xs text-slate-400">approved, awaiting payment</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Failed payments</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{failedOrders.length}</p>
          <p className="mt-1 text-xs text-slate-400">did not increase revenue</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading orders...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-500">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">Size</th>
                  <th className="py-2 pr-4 font-medium">Qty</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Requested by</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Razorpay payment ID</th>
                  <th className="py-2 pr-4 font-medium">Paid at</th>
                  <th className="py-2 pr-4 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <ProductImage src={order.productPhotoUrl} alt={order.productName} className="h-10 w-8 rounded" />
                        <span>{order.productName}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4">{order.selectedSize ?? '—'}</td>
                    <td className="py-2 pr-4">{order.quantity}</td>
                    <td className="py-2 pr-4">₹{order.orderValue}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {order.buyerType === 'ai_agent' ? 'AI Shopping Agent' : (order.buyerType ?? 'Unknown')}
                      {order.buyerSessionId && (
                        <span className="block font-mono text-slate-400">
                          session {order.buyerSessionId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          STATUS_STYLES[order.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                      {order.razorpayPaymentId ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
