import { createContext } from 'react';
import type { LoginRequest, MerchantProfile, SignupRequest } from '@ai-agent-storefront/shared';

export interface AuthContextValue {
  merchant: MerchantProfile | null;
  isLoading: boolean;
  login: (input: LoginRequest) => Promise<void>;
  signup: (input: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
