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

export interface ProductProfile {
  id: string;
  merchantId: string;
  name: string;
  price: string;
  material: string;
  color: string;
  sizeOptions: string[];
  stock: number;
  photoUrl: string;
  isAiReady: boolean;
  blocked: boolean;
  createdAt: string;
}

export interface ProductListResponse {
  products: ProductProfile[];
}

export interface ProductResponse {
  product: ProductProfile;
}

export interface UpdateProductRequest {
  price?: number;
  stock?: number;
  blocked?: boolean;
}

export interface CsvUploadRowError {
  row: number;
  message: string;
}

export interface CsvUploadResponse {
  created: number;
  skipped: number;
  errors: CsvUploadRowError[];
}
