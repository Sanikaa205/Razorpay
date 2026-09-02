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

export type ActionType = 'info_only' | 'order_attempt' | 'out_of_stock';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface StoreAiMatchedProduct {
  id: string;
  name: string;
  price: string;
  photo_url: string;
  material: string;
  color: string;
  size_options: string[];
  stock_status: StockStatus;
}

export interface StoreAiQueryRequest {
  merchantId: string;
  buyerQuery: string;
}

export interface StoreAiAnswer {
  action_type: ActionType;
  matched_product: StoreAiMatchedProduct | null;
  is_alternative: boolean;
  message: string;
}

export interface StoreAiQueryResponse extends StoreAiAnswer {
  conversationId: string;
}

export type OrderStatus =
  | 'pending_approval'
  | 'auto_approved'
  | 'merchant_approved'
  | 'rejected'
  | 'paid'
  | 'failed';

export interface OrderProfile {
  id: string;
  merchantId: string;
  productId: string;
  conversationId: string | null;
  orderValue: string;
  status: OrderStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmOrderRequest {
  conversationId: string;
  productId: string;
  userConfirmed: boolean;
}

export interface OrderResponse {
  order: OrderProfile;
}
