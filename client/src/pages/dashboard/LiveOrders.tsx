import { useCallback, useEffect, useState } from 'react';
import type { AuditLogListResponse } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../api/client';
import { buildAuditStories } from './auditNarrative';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'AI query: success' },
  { value: 'hallucination_blocked', label: 'AI query: blocked hallucination' },
  { value: 'auto_approved', label: 'Order: auto-approved' },
  { value: 'paid', label: 'Payment: paid' },
  { value: 'failed', label: 'Payment: failed' },
  { value: 'decremented', label: 'Stock: decreased' },
  { value: 'error', label: 'Error' },
];

const POLL_INTERVAL_MS = 4000;

export default function LiveOrders() {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [response, setResponse] = useState<AuditLogListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());

    try {
      const data = await apiFetch<AuditLogListResponse>(`/api/audit-logs?${params.toString()}`);
      setResponse(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit trail');
    } finally {
      setIsLoading(false);
    }
  }, [status, from, to]);

  useEffect(() => {
    setIsLoading(true);
    loadLogs();
    const interval = setInterval(loadLogs, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadLogs]);

  const stories = response ? buildAuditStories(response.logs) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Live Orders & Audit Trail</h1>
        <p className="mt-1 text-slate-500">
          A running feed of every AI query, order decision, and payment event, in plain language.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-500">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        {(status || from || to) && (
          <button
            onClick={() => {
              setStatus('');
              setFrom('');
              setTo('');
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">Live — refreshes every few seconds</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading audit trail...</p>
      ) : stories.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet.</p>
      ) : (
        <div className="space-y-3">
          {stories.map((story) => (
            <div key={story.key} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-800">{story.narrative}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(story.latestTimestamp).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
