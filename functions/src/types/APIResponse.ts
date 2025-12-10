/**
 * @fileoverview Generic API response type definitions
 * @module types/APIResponse
 */

/**
 * Base success response structure
 *
 * @interface APISuccessResponse
 * @template T - Type of the data payload
 */
export interface APISuccessResponse<T = unknown> {
  /** Always true for success */
  success: true;

  /** Response data payload */
  data: T;

  /** Optional message */
  message?: string;
}

/**
 * Base error response structure
 *
 * @interface APIErrorResponse
 */
export interface APIErrorResponse {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code */
  code: string;

  /** Additional error details (only in development) */
  details?: unknown;
}

/**
 * Union type for all API responses
 */
export type APIResponse<T = unknown> = APISuccessResponse<T> | APIErrorResponse;

/**
 * Audit log entry structure
 *
 * @interface AuditLogEntry
 */
export interface AuditLogEntry {
  /** Reference to the license document */
  license_id: string;

  /** Type of request being logged */
  request_type: "license_validation" | "ai_request" | "task_submission";

  /** Provider used (for AI requests) */
  provider_used?: "openai" | "gemini" | "claude";

  /** Input tokens consumed */
  tokens_input?: number;

  /** Output tokens generated */
  tokens_output?: number;

  /** Cost in USD */
  cost_usd?: number;

  /** Request status */
  status: "success" | "failed" | "timeout";

  /** Error message if failed */
  error_message?: string;

  /** Response time in milliseconds */
  response_time_ms?: number;

  /** Client IP address */
  ip_address: string;

  /** Additional metadata (tier info, steps, etc.) */
  metadata?: Record<string, unknown>;

  /** Timestamp of the request */
  created_at: FirebaseFirestore.Timestamp;
}

/**
 * Rate limit counter document structure
 *
 * @interface RateLimitCounter
 */
export interface RateLimitCounter {
  /** Endpoint being rate limited */
  endpoint: string;

  /** Client IP address */
  ip_address: string;

  /** Hour bucket (Unix timestamp truncated to hour) */
  hour: number;

  /** Request count in this window */
  count: number;

  /** TTL for auto-deletion */
  ttl: FirebaseFirestore.Timestamp;
}
