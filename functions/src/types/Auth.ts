/**
 * @fileoverview Authentication request/response type definitions
 * @module types/Auth
 */

import { LicensePlan } from "./License";

/**
 * Request body for POST /api/auth/validate-license
 *
 * @interface ValidateLicenseRequest
 *
 * @example
 * ```typescript
 * const request: ValidateLicenseRequest = {
 *   license_key: "CREATOR-2024-ABCDE-FGHIJ",
 *   site_url: "https://mysite.com"
 * };
 * ```
 */
export interface ValidateLicenseRequest {
  /** License key to validate (format: CREATOR-YYYY-XXXXX-XXXXX) */
  license_key: string;

  /** Site URL requesting validation */
  site_url: string;
}

/**
 * Success response for license validation
 *
 * @interface ValidateLicenseSuccessResponse
 */
export interface ValidateLicenseSuccessResponse {
  /** Always true for success */
  success: true;

  /** User ID associated with the license */
  user_id: string;

  /** JWT token for subsequent API calls */
  site_token: string;

  /** Subscription plan type */
  plan: LicensePlan;

  /** Maximum tokens allowed per billing period */
  tokens_limit: number;

  /** Remaining tokens in current billing period */
  tokens_remaining: number;

  /** ISO date string for next quota reset */
  reset_date: string;
}

/**
 * Error response for license validation
 *
 * @interface ValidateLicenseErrorResponse
 */
export interface ValidateLicenseErrorResponse {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code */
  code: ErrorCode;
}

/**
 * Union type for all possible validation responses
 */
export type ValidateLicenseResponse =
  | ValidateLicenseSuccessResponse
  | ValidateLicenseErrorResponse;

/**
 * Error codes for license validation failures
 */
export type ErrorCode =
  | "INVALID_FORMAT"
  | "LICENSE_NOT_FOUND"
  | "LICENSE_SUSPENDED"
  | "LICENSE_EXPIRED"
  | "URL_MISMATCH"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "INVALID_METHOD"
  | "MISSING_FIELDS";

/**
 * Error code to HTTP status code mapping
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_FORMAT: 400,
  MISSING_FIELDS: 400,
  INVALID_METHOD: 405,
  LICENSE_NOT_FOUND: 404,
  LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403,
  URL_MISMATCH: 403,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Error code to human-readable message mapping
 */
export const ERROR_MESSAGE_MAP: Record<ErrorCode, string> = {
  INVALID_FORMAT: "Invalid license key format",
  MISSING_FIELDS: "Missing required fields: license_key and site_url",
  INVALID_METHOD: "Method not allowed. Use POST",
  LICENSE_NOT_FOUND: "License not found",
  LICENSE_SUSPENDED: "License has been suspended",
  LICENSE_EXPIRED: "License has expired",
  URL_MISMATCH: "Site URL does not match registered URL",
  QUOTA_EXCEEDED: "Token quota exceeded",
  RATE_LIMITED: "Too many requests. Please try again later",
  INTERNAL_ERROR: "Internal server error",
};
