/**
 * @fileoverview JWT Claims type definitions
 * @module types/JWTClaims
 */

import { LicensePlan } from "./License";

/**
 * JWT Claims structure for site_token
 *
 * @interface JWTClaims
 * @description Claims embedded in the JWT site_token for authentication
 *
 * @example
 * ```typescript
 * const claims: JWTClaims = {
 *   license_id: "CREATOR-2024-ABCDE-FGHIJ",
 *   site_url: "https://mysite.com",
 *   plan: "pro",
 *   iat: 1700000000,
 *   exp: 1700086400, // iat + 24h
 *   jti: "550e8400-e29b-41d4-a716-446655440000"
 * };
 * ```
 */
export interface JWTClaims {
  /** License ID (license_key) for audit trail */
  license_id: string;

  /** Registered site URL for verification */
  site_url: string;

  /** Subscription plan type */
  plan: LicensePlan;

  /** Issued At timestamp (Unix seconds) */
  iat: number;

  /** Expiration timestamp (Unix seconds, iat + 86400 for 24h) */
  exp: number;

  /** JWT ID - unique identifier for potential revocation */
  jti: string;
}

/**
 * Payload for JWT generation (without auto-generated fields)
 */
export interface JWTPayload {
  license_id: string;
  site_url: string;
  plan: LicensePlan;
}

/**
 * JWT configuration options
 */
export interface JWTOptions {
  /** Token expiration time in seconds (default: 86400 = 24h) */
  expiresIn?: number;
}

/**
 * Result of JWT verification
 */
export interface JWTVerifyResult {
  /** Whether the token is valid */
  valid: boolean;

  /** Decoded claims if valid */
  claims?: JWTClaims;

  /** Error message if invalid */
  error?: string;
}
