import type { Product } from '@prisma/client';
import type { ProductProfile } from '@ai-agent-storefront/shared';

export function toProductProfile(product: Product): ProductProfile {
  return {
    id: product.id,
    merchantId: product.merchantId,
    name: product.name,
    price: product.price.toString(),
    material: product.material,
    color: product.color,
    sizeOptions: product.sizeOptions,
    stock: product.stock,
    photoUrl: product.photoUrl,
    isAiReady: product.isAiReady,
    blocked: product.blocked,
    rawData: (product.rawData as Record<string, unknown> | null) ?? null,
    createdAt: product.createdAt.toISOString(),
  };
}

export function parseSizeOptions(raw: string | undefined | null): string[] {
  if (!raw) return ['Free Size'];
  const sizes = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return sizes.length > 0 ? sizes : ['Free Size'];
}

export function placeholderPhotoUrl(seed: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/600/800`;
}
