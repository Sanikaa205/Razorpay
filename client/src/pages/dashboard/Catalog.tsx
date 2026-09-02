import { useCallback, useEffect, useState } from 'react';
import type { ProductListResponse, ProductProfile, ProductResponse, UpdateProductRequest } from '@ai-agent-storefront/shared';
import { apiFetch, ApiError } from '../../api/client';
import { CsvUploadCard } from './catalog/CsvUploadCard';
import { AddProductForm } from './catalog/AddProductForm';
import { ProductTable } from './catalog/ProductTable';

export default function Catalog() {
  const [products, setProducts] = useState<ProductProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<ProductListResponse>('/api/products');
      setProducts(data.products);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function handleUpdate(id: string, patch: UpdateProductRequest) {
    const data = await apiFetch<ProductResponse>(`/api/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setProducts((prev) => prev.map((p) => (p.id === id ? data.product : p)));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Catalog</h1>
        <p className="mt-1 text-slate-500">Manage the products your AI agent can sell.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CsvUploadCard onUploaded={loadProducts} />
        <AddProductForm onCreated={loadProducts} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Products {!isLoading && `(${products.length})`}
        </h2>
        {isLoading ? (
          <p className="text-slate-500">Loading products...</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <ProductTable products={products} onUpdate={handleUpdate} />
        )}
      </div>
    </div>
  );
}
