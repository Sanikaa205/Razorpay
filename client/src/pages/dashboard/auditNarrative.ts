import type { AuditLogEntry } from '@ai-agent-storefront/shared';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** One human-readable clause for a single audit log entry. Clauses are
 * joined with " → " to build the full story for a conversation/order. */
export function narrateLogEntry(log: AuditLogEntry): string | null {
  const meta = log.metadata ?? {};

  switch (log.step) {
    case 'store_ai_query': {
      const query = asString(meta.buyerQuery, 'something');
      if (log.outcome === 'success') {
        const productName = typeof meta.matchedProductName === 'string' ? meta.matchedProductName : null;
        return productName
          ? `AI agent asked about "${query}" → shown ${productName}`
          : `AI agent asked about "${query}" → no matching product found`;
      }
      if (log.outcome === 'hallucination_blocked') {
        return `AI agent asked about "${query}" → blocked an unverified product match`;
      }
      return `AI agent asked about "${query}" → Store AI request failed`;
    }
    case 'order_confirmation': {
      const reason = asString(meta.reason);
      return log.outcome === 'auto_approved'
        ? `user confirmed → order auto-approved (${reason})`
        : `user confirmed → order held for approval (${reason})`;
    }
    case 'order_approval':
      return log.outcome === 'merchant_approved' ? 'merchant approved' : 'merchant rejected';
    case 'payment_status_updated':
      return log.outcome === 'paid'
        ? 'payment received via Razorpay'
        : 'payment failed via Razorpay';
    default:
      return null;
  }
}

export interface AuditStory {
  key: string;
  entries: AuditLogEntry[];
  narrative: string;
  latestTimestamp: string;
}

/** Groups audit log entries into per-conversation "stories" and renders each
 * as one arrow-chained plain-language sentence, newest story first. */
export function buildAuditStories(logs: AuditLogEntry[]): AuditStory[] {
  const groups = new Map<string, AuditLogEntry[]>();

  for (const log of logs) {
    const key = log.conversationId ?? log.orderId ?? log.id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(log);
    } else {
      groups.set(key, [log]);
    }
  }

  const stories: AuditStory[] = [];
  for (const [key, entries] of groups) {
    const chronological = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const clauses = chronological.map(narrateLogEntry).filter((c): c is string => Boolean(c));
    if (clauses.length === 0) continue;

    stories.push({
      key,
      entries: chronological,
      narrative: clauses.join(' → '),
      latestTimestamp: chronological[chronological.length - 1].timestamp,
    });
  }

  return stories.sort(
    (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime(),
  );
}
