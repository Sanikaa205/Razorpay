import { useEffect, useState } from 'react';
import type { OrderListResponse, OrderWithProduct } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError, resolveAssetUrl } from '../../api/client';

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  auto_approved: 'bg-blue-100 text-blue-800',
  merchant_approved: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-red-100 text-red-800',
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function Payments() {
  const [orders, setOrders] = useState<OrderWithProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OrderListResponse>('/api/orders')
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load orders'))
      .finally(() => setIsLoading(false));
  }, []);

  const paidOrders = orders.filter((o) => o.status === 'paid');
  const settledTotal = paidOrders.reduce((sum, o) => sum + Number(o.orderValue), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="mt-1 text-slate-500">Every order and its Razorpay payment status.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total settled (paid orders)</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            ₹{settledTotal.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {paidOrders.length} paid order{paidOrders.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total orders</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{orders.length}</p>
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
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Razorpay order</th>
                  <th className="py-2 pr-4 font-medium">Razorpay payment</th>
                  <th className="py-2 pr-4 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <img
                          src={resolveAssetUrl(order.productPhotoUrl)}
                          alt={order.productName}
                          className="h-10 w-8 rounded object-cover"
                        />
                        <span>{order.productName}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4">₹{order.orderValue}</td>
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
                      {order.razorpayOrderId ?? '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                      {order.razorpayPaymentId ?? '—'}
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
