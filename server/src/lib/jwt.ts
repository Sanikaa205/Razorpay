import jwt from 'jsonwebtoken';

const envSecret = process.env.JWT_SECRET;
if (!envSecret) {
  throw new Error('JWT_SECRET is not set');
}
const JWT_SECRET: string = envSecret;

const TOKEN_TTL = '7d';
export const AUTH_COOKIE_NAME = 'auth_token';

export interface AuthTokenPayload {
  merchantId: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
