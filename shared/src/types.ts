export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
}

export interface MerchantProfile {
  id: string;
  name: string;
  email: string;
  razorpayAccountId: string | null;
  autoApproveLimit: string;
  requireManualApproval: boolean;
  createdAt: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  merchant: MerchantProfile;
}
