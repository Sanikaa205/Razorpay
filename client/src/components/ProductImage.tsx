import { useEffect, useState } from 'react';
import { resolveAssetUrl } from '../api/client';

const FALLBACK_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="266" viewBox="0 0 200 266">' +
      '<rect width="200" height="266" fill="#e2e8f0"/>' +
      '<rect x="68" y="86" width="64" height="50" rx="4" fill="none" stroke="#94a3b8" stroke-width="3"/>' +
      '<circle cx="84" cy="101" r="6" fill="#94a3b8"/>' +
      '<path d="M68 130l20-20 16 16 12-12 16 16" fill="none" stroke="#94a3b8" stroke-width="3"/>' +
      '<text x="100" y="168" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">No image</text>' +
      '</svg>',
  );

/** True if the value is at least a syntactically valid absolute http(s) URL — not a guarantee it serves an image. */
function isRenderableUrl(src: string | null | undefined): src is string {
  if (!src) return false;
  try {
    const parsed = new URL(src, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Renders a product photo with a loading skeleton and a guaranteed graceful
 * fallback (an inline SVG, so it never depends on a network request that
 * could itself fail) when the URL is missing, malformed, or the browser
 * fails to load it — e.g. a dead link, a revoked share link, or a page URL
 * that isn't actually a direct image file. This is what keeps a bad
 * merchant-supplied Image URL from ever rendering as a broken-image icon.
 */
export function ProductImage({
  src,
  alt,
  className = '',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const resolved = isRenderableUrl(src) ? resolveAssetUrl(src) : null;
  // `failed` tracks only the *real* src's load outcome. Once true, we always
  // render FALLBACK_SVG instead — and specifically ignore that fallback
  // image's own load/error events, so its successful load can never be
  // mistaken for the real photo having loaded (which previously flipped the
  // src back to the broken URL and looped forever).
  const [failed, setFailed] = useState(!resolved);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(!resolved);
    setLoaded(false);
  }, [resolved]);

  const showingFallback = failed || !resolved;

  return (
    <div className={`relative shrink-0 overflow-hidden bg-slate-100 ${className}`}>
      {!showingFallback && !loaded && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
      <img
        src={showingFallback ? FALLBACK_SVG : resolved}
        alt={alt}
        onLoad={() => {
          if (!showingFallback) setLoaded(true);
        }}
        onError={() => {
          if (!showingFallback) setFailed(true);
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
