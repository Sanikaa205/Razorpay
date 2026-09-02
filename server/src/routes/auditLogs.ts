import { Router } from 'express';
import type { AuditLogListResponse } from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Protected: merchantId always comes from the session, never the query
// string - a merchant can only ever see their own audit trail.
auditLogsRouter.get('/', async (req, res) => {
  const { status, from, to } = req.query as { status?: string; from?: string; to?: string };

  const timestampFilter: { gte?: Date; lte?: Date } = {};
  if (from) timestampFilter.gte = new Date(from);
  if (to) timestampFilter.lte = new Date(to);

  const logs = await prisma.auditLog.findMany({
    where: {
      merchantId: req.merchantId,
      ...(status ? { outcome: status } : {}),
      ...(from || to ? { timestamp: timestampFilter } : {}),
    },
    include: { order: { select: { conversationId: true } } },
    orderBy: { timestamp: 'desc' },
  });

  const body: AuditLogListResponse = {
    logs: logs.map((log) => {
      const metadata = isRecord(log.metadata) ? log.metadata : null;
      const conversationId =
        log.order?.conversationId ??
        (typeof metadata?.conversationId === 'string' ? metadata.conversationId : null);

      return {
        id: log.id,
        merchantId: log.merchantId,
        orderId: log.orderId,
        conversationId,
        step: log.step,
        outcome: log.outcome,
        metadata,
        timestamp: log.timestamp.toISOString(),
      };
    }),
  };

  res.json(body);
});
