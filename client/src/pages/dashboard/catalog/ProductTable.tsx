import { useEffect, useState } from 'react';
import type { ProductProfile, UpdateProductRequest } from '@ai-agent-storefront/shared';
import { ProductImage } from '../../../components/ProductImage';

function EditableNumberCell({
  value,
  prefix,
  onSave,
}: {
  value: number;
  prefix?: string;
  onSave: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  async function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed === value) {
      setDraft(String(value));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
    } catch {
      setDraft(String(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-slate-500">{prefix}</span>}
      <input
        type="number"
        min="0"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
      />
    </div>
  );
}

export function ProductTable({
  products,
  onUpdate,
}: {
  products: ProductProfile[];
  onUpdate: (id: string, patch: UpdateProductRequest) => Promise<void>;
}) {
  if (products.length === 0) {
    return <p className="text-slate-500">No products yet. Add one above or upload a CSV.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-4 font-medium">Photo</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Price</th>
            <th className="py-2 pr-4 font-medium">Stock</th>
            <th className="py-2 pr-4 font-medium">AI Ready</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-slate-100">
              <td className="py-2 pr-4">
                <ProductImage src={product.photoUrl} alt={product.name} className="h-14 w-11 rounded" />
              </td>
              <td className="py-2 pr-4">
                <p className="font-medium text-slate-900">{product.name}</p>
                <p className="text-xs text-slate-500">
                  {[product.material, product.color, product.sizeOptions.join('/')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </td>
              <td className="py-2 pr-4">
                <EditableNumberCell
                  value={Number(product.price)}
                  prefix="₹"
                  onSave={(value) => onUpdate(product.id, { price: value })}
                />
              </td>
              <td className="py-2 pr-4">
                <EditableNumberCell
                  value={product.stock}
                  onSave={(value) => onUpdate(product.id, { stock: value })}
                />
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    product.isAiReady
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {product.isAiReady ? 'AI Ready' : 'Not Ready'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
