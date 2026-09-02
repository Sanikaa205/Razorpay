import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthResponse, LoginRequest, MerchantProfile, SignupRequest } from '@ai-agent-storefront/shared';
import { apiFetch } from '../api/client';
import { AuthContext } from './authContextValue';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch<AuthResponse>('/api/auth/me')
      .then((data) => setMerchant(data.merchant))
      .catch(() => setMerchant(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const data = await apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setMerchant(data.merchant);
  }, []);

  const signup = useCallback(async (input: SignupRequest) => {
    const data = await apiFetch<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setMerchant(data.merchant);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setMerchant(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ merchant, isLoading, login, signup, logout, updateMerchant: setMerchant }}
    >
      {children}
    </AuthContext.Provider>
  );
}
