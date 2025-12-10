/**
 * @fileoverview License type definitions for Creator AI Proxy
 * @module types/License
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Plan types available for licenses
 */
export type LicensePlan = "starter" | "pro" | "enterprise";

/**
 * Status types for license state
 */
export type LicenseStatus = "active" | "suspended" | "expired";

/**
 * License document structure in Firestore
 *
 * @interface License
 * @description Represents a license record stored in the 'licenses' collection
 *
 * @example
 * ```typescript
 * const license: License = {
 *   license_key: "CREATOR-2024-ABCDE-FGHIJ",
 *   site_url: "https://mysite.com",
 *   site_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   user_id: "user_123",
 *   plan: "pro",
 *   tokens_limit: 50000000,
 *   tokens_used: 1000000,
 *   status: "active",
 *   reset_date: Timestamp.fromDate(new Date("2025-12-01")),
 *   expires_at: Timestamp.fromDate(new Date("2026-01-01")),
 *   created_at: Timestamp.now(),
 *   updated_at: Timestamp.now()
 * };
 * ```
 */
export interface License {
  /** Unique license key in format CREATOR-YYYY-XXXXX-XXXXX */
  license_key: string;

  /** Registered site URL (pre-set at creation, cannot be changed) */
  site_url: string;

  /** JWT token for site authentication (generated on first validation) */
  site_token?: string;

  /** User ID associated with this license */
  user_id: string;

  /** Subscription plan type */
  plan: LicensePlan;

  /** Maximum tokens allowed per billing period */
  tokens_limit: number;

  /** Tokens consumed in current billing period */
  tokens_used: number;

  /** Available credits for AI requests */
  credits_available?: number;

  /** Credits consumed in current billing period */
  credits_used?: number;

  /** Current license status */
  status: LicenseStatus;

  /** Date when token usage resets */
  reset_date: Timestamp;

  /** License expiration date */
  expires_at: Timestamp;

  /** Record creation timestamp */
  created_at: Timestamp;

  /** Last update timestamp */
  updated_at: Timestamp;
}

/**
 * License data for creating a new license (without auto-generated fields)
 */
export interface CreateLicenseData {
  license_key: string;
  site_url: string;
  user_id: string;
  plan: LicensePlan;
  tokens_limit: number;
  expires_at: Date;
  reset_date: Date;
}

/**
 * License update data (partial update)
 */
export interface UpdateLicenseData {
  site_token?: string;
  tokens_used?: number;
  status?: LicenseStatus;
  updated_at?: Timestamp;
}
