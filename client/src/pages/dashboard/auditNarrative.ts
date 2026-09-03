import type { AuditLogEntry } from '@ai-agent-storefront/shared';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Short, non-identifying tag for whichever buyer/agent session this log entry belongs to, e.g. "AI Shopping Agent (session ab12cd34)". Never a real name. */
function buyerLabel(meta: Record<string, unknown>): string {
  const type = asString(meta.buyerType) === 'ai_agent' || !meta.buyerType ? 'AI Shopping Agent' : asString(meta.buyerType);
  const sessionId = asString(meta.buyerSessionId);
  return sessionId ? `${type} (session ${sessionId.slice(0, 8)})` : type;
}

/** One human-readable clause for a single audit log entry. Clauses are
 * joined with " → " to build the full story for a conversation/order. */
export function narrateLogEntry(log: AuditLogEntry): string | null {
  const meta = log.metadata ?? {};

  switch (log.step) {
    case 'store_ai_query': {
      const query = asString(meta.buyerQuery, 'something');
      const who = buyerLabel(meta);
      if (log.outcome === 'success') {
        const productName = typeof meta.matchedProductName === 'string' ? meta.matchedProductName : null;
        return productName
          ? `${who} asked about "${query}" → shown ${productName}`
          : `${who} asked about "${query}" → no matching product found`;
      }
      if (log.outcome === 'hallucination_blocked') {
        return `${who} asked about "${query}" → blocked an unverified product match`;
      }
      return `${who} asked about "${query}" → Store AI request failed`;
    }
    case 'order_confirmation': {
      const reason = asString(meta.reason);
      const size = typeof meta.selectedSize === 'string' ? `, size ${meta.selectedSize}` : '';
      const quantityCount = typeof meta.quantity === 'number' && meta.quantity > 1 ? ` (x${meta.quantity})` : '';
      const quantity = `${quantityCount}${size}`;
      return log.outcome === 'auto_approved'
        ? `buyer confirmed${quantity} → order auto-approved (${reason})`
        : `buyer confirmed${quantity} → order held for approval (${reason})`;
    }
    case 'order_approval':
      return log.outcome === 'merchant_approved' ? 'merchant approved' : 'merchant rejected';
    case 'payment_status_updated':
      return log.outcome === 'paid'
        ? 'payment received via Razorpay'
        : 'payment failed via Razorpay';
    case 'stock_updated': {
      const qty = typeof meta.quantityDeducted === 'number' ? meta.quantityDeducted : null;
      return qty !== null ? `stock decreased by ${qty} unit${qty === 1 ? '' : 's'}` : 'stock updated';
    }
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
