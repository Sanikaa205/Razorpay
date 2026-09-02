import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CsvUploadResponse } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../../api/client';

export function CsvUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<CsvUploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<CsvUploadResponse>('/api/products/upload-csv', {
        method: 'POST',
        body: formData,
      });
      setResult(data);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Bulk upload via CSV</h2>
      <p className="mt-1 text-sm text-slate-500">
        Columns: name, price, material, color, size, stock, photo_url.{' '}
        <a
          href="/sample-products-template.csv"
          download
          className="font-medium text-slate-900 underline"
        >
          Download sample template
        </a>
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="text-sm text-slate-700"
        />
        <button
          type="submit"
          disabled={isUploading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isUploading ? 'Uploading...' : 'Upload CSV'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
          <p className="text-slate-700">
            Created <strong>{result.created}</strong> product{result.created === 1 ? '' : 's'}
            {result.skipped > 0 && (
              <>
                , skipped <strong>{result.skipped}</strong> row{result.skipped === 1 ? '' : 's'}
              </>
            )}
            .
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-red-600">
              {result.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
