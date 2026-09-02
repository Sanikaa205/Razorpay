import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch, ApiError } from '../../../api/client';

const initialFormState = {
  name: '',
  price: '',
  material: '',
  color: '',
  size: '',
  stock: '',
  photoUrl: '',
};

export function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState(initialFormState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('price', form.price);
      formData.append('material', form.material);
      formData.append('color', form.color);
      formData.append('size', form.size);
      formData.append('stock', form.stock);
      if (form.photoUrl) formData.append('photoUrl', form.photoUrl);
      const file = fileInputRef.current?.files?.[0];
      if (file) formData.append('photo', file);

      await apiFetch('/api/products', { method: 'POST', body: formData });

      setForm(initialFormState);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create product');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Add a product</h2>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
        <input
          required
          placeholder="Name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="number"
          min="0"
          step="0.01"
          placeholder="Price (₹)"
          value={form.price}
          onChange={(e) => update('price', e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          min="0"
          placeholder="Stock"
          value={form.stock}
          onChange={(e) => update('stock', e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Material"
          value={form.material}
          onChange={(e) => update('material', e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Color"
          value={form.color}
          onChange={(e) => update('color', e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Sizes (comma separated, e.g. S,M,L)"
          value={form.size}
          onChange={(e) => update('size', e.target.value)}
          className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Image URL (optional if uploading a file)"
          value={form.photoUrl}
          onChange={(e) => update('photoUrl', e.target.value)}
          className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="col-span-2 text-sm text-slate-700"
        />

        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="col-span-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? 'Adding...' : 'Add product'}
        </button>
      </form>
    </div>
  );
}
