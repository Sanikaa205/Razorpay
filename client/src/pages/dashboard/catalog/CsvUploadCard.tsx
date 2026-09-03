import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CsvPreviewResponse,
  CsvPreviewRow,
  CsvUploadResponse,
  StoreAiQueryResponse,
} from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../../api/client';
import { useAuth } from '../../../context/useAuth';
import { ProductImage } from '../../../components/ProductImage';

type Stage = 'idle' | 'previewing' | 'reviewing' | 'saving' | 'saved';

const FLAG_STYLES: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
};

function FieldValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-400">{label}: </span>
      <span className={value ? 'text-slate-700' : 'italic text-slate-400'}>{value || 'empty'}</span>
    </div>
  );
}

function RowComparison({ row }: { row: CsvPreviewRow }) {
  const { transformed, flags } = row;
  return (
    <div
      className={`rounded-md border p-3 text-xs ${
        row.valid ? 'border-slate-200' : 'border-red-300 bg-red-50/40'
      }`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Before (raw row)</p>
          <div className="space-y-0.5">
            {Object.entries(row.raw).map(([col, val]) => (
              <FieldValue key={col} label={col} value={val} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
            After (standardized)
          </p>
          <div className="flex gap-2">
            <ProductImage
              src={transformed.photoUrl}
              alt={transformed.name || 'Product photo'}
              className="h-16 w-14 rounded"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <FieldValue label="name" value={transformed.name} />
              <FieldValue label="price" value={transformed.price !== null ? `₹${transformed.price}` : ''} />
              <FieldValue label="material" value={transformed.material} />
              <FieldValue label="color" value={transformed.color} />
              <FieldValue label="sizeOptions" value={transformed.sizeOptions.join(', ')} />
              <FieldValue label="stock" value={String(transformed.stock)} />
            </div>
          </div>
        </div>
      </div>
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.map((f, i) => (
            <span key={i} className={`rounded-full px-2 py-0.5 ${FLAG_STYLES[f.severity]}`}>
              {f.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CsvUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { merchant } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [preview, setPreview] = useState<CsvPreviewResponse | null>(null);
  const [saveResult, setSaveResult] = useState<CsvUploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<StoreAiQueryResponse | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV or Excel file first');
      return;
    }

    setStage('previewing');
    setError(null);
    setPreview(null);
    setSaveResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<CsvPreviewResponse>('/api/products/upload-csv/preview', {
        method: 'POST',
        body: formData,
      });
      setPreview(data);
      setStage('reviewing');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read this file');
      setStage('idle');
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setStage('saving');
    setError(null);
    try {
      const data = await apiFetch<CsvUploadResponse>('/api/products/upload-csv/confirm', {
        method: 'POST',
        body: JSON.stringify({
          rows: preview.rows
            .filter((r) => r.valid)
            .map((r) => ({ raw: r.raw, transformed: r.transformed })),
        }),
      });
      setSaveResult(data);
      setStage('saved');
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      setStage('reviewing');
    }
  }

  function startOver() {
    setStage('idle');
    setPreview(null);
    setSaveResult(null);
    setError(null);
    setTestResult(null);
    setTestError(null);
    setTestQuery('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function runTestQuery(e: FormEvent) {
    e.preventDefault();
    if (!testQuery.trim() || !merchant) return;
    setIsTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const data = await apiFetch<StoreAiQueryResponse>('/api/store-ai/query', {
        method: 'POST',
        body: JSON.stringify({ merchantId: merchant.id, buyerQuery: testQuery.trim() }),
      });
      setTestResult(data);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : 'Query failed');
    } finally {
      setIsTesting(false);
    }
  }

  const validCount = preview?.rows.filter((r) => r.valid).length ?? 0;
  const invalidCount = (preview?.rows.length ?? 0) - validCount;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Bulk upload via CSV or Excel</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload a file with any column names — we auto-detect and map them to name, price,
        material, color, sizes, stock, and photo.{' '}
        <a
          href="/messy-sample-catalog.csv"
          download
          className="font-medium text-slate-900 underline"
        >
          Download a deliberately messy sample file
        </a>
      </p>

      {stage === 'idle' && (
        <form onSubmit={handlePreview} className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            className="min-w-0 text-sm text-slate-700"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Preview
          </button>
        </form>
      )}

      {stage === 'previewing' && (
        <p className="mt-4 text-sm text-slate-500">Reading file and mapping columns...</p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {(stage === 'reviewing' || stage === 'saving') && preview && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Detected <strong>{preview.detectedColumns.length}</strong> columns, mapped via{' '}
              <strong>{preview.mappingSource === 'llm' ? 'AI' : 'rule-based'}</strong> matching.
              <strong> {validCount}</strong> row{validCount === 1 ? '' : 's'} ready to save
              {invalidCount > 0 && (
                <>
                  , <strong className="text-red-600">{invalidCount}</strong> will be skipped
                </>
              )}
              .
            </p>
          </div>

          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {preview.rows.map((row) => (
              <RowComparison key={row.rowNumber} row={row} />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={stage === 'saving' || validCount === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {stage === 'saving' ? 'Saving...' : `Confirm & save ${validCount} product${validCount === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={startOver}
              disabled={stage === 'saving'}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'saved' && saveResult && (
        <div className="mt-4 space-y-4">
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            Saved <strong>{saveResult.created}</strong> product{saveResult.created === 1 ? '' : 's'} to
            your live catalog.
            {saveResult.skipped > 0 && ` Skipped ${saveResult.skipped} invalid row(s).`}
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-900">
              Try the Store AI against your new catalog
            </p>
            <p className="mt-1 text-xs text-slate-500">
              This runs a real query against the products you just uploaded, to prove the
              transformed data actually matches — not just displays.
            </p>
            <form onSubmit={runTestQuery} className="mt-2 flex gap-2">
              <input
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="e.g. do you have a sky blue mesh dress?"
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={isTesting || !testQuery.trim()}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isTesting ? 'Asking...' : 'Ask'}
              </button>
            </form>
            {testError && <p className="mt-2 text-sm text-red-600">{testError}</p>}
            {testResult && (
              <div className="mt-2 rounded-md bg-slate-50 p-3 text-sm">
                <p className="text-slate-700">{testResult.message}</p>
                {testResult.matched_product && (
                  <div className="mt-2 flex gap-2">
                    <ProductImage
                      src={testResult.matched_product.photo_url}
                      alt={testResult.matched_product.name}
                      className="h-16 w-14 rounded"
                    />
                    <div>
                      <p className="font-medium text-slate-900">{testResult.matched_product.name}</p>
                      <p className="text-slate-600">
                        ₹{testResult.matched_product.price} · {testResult.matched_product.material} ·{' '}
                        {testResult.matched_product.color}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={startOver}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}
