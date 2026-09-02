import { Router } from 'express';
import type { HealthCheckResponse } from '@ai-agent-storefront/shared';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});
