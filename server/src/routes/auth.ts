import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { AuthResponse, LoginRequest, SignupRequest } from '@ai-agent-storefront/shared';
import { prisma } from '../prisma';
import { AUTH_COOKIE_NAME, signAuthToken } from '../lib/jwt';
import { toMerchantProfile } from '../lib/merchant';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setAuthCookie(res: import('express').Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

authRouter.post('/signup', async (req, res) => {
  const { name, email, password } = req.body as Partial<SignupRequest>;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email, and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = await prisma.merchant.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const merchant = await prisma.merchant.create({
    data: { name, email, passwordHash },
  });

  const token = signAuthToken({ merchantId: merchant.id });
  setAuthCookie(res, token);

  const body: AuthResponse = { merchant: toMerchantProfile(merchant) };
  res.status(201).json(body);
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as Partial<LoginRequest>;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const merchant = await prisma.merchant.findUnique({ where: { email } });
  if (!merchant) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, merchant.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signAuthToken({ merchantId: merchant.id });
  setAuthCookie(res, token);

  const body: AuthResponse = { merchant: toMerchantProfile(merchant) };
  res.json(body);
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.status(204).send();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.merchantId } });
  if (!merchant) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const body: AuthResponse = { merchant: toMerchantProfile(merchant) };
  res.json(body);
});
