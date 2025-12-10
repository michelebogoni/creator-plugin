/**
 * @fileoverview Licensing business logic service
 * @module services/licensing
 */

import { License } from "../types/License";
import {
  ErrorCode,
  ValidateLicenseRequest,
  ValidateLicenseSuccessResponse,
  ValidateLicenseErrorResponse,
} from "../types/Auth";
import {
  getLicenseByKey,
  updateLicense,
  createAuditLog,
  isTimestampExpired,
  timestampToISO,
} from "../lib/firestore";
import { generateToken, decodeToken, isTokenExpired } from "../lib/jwt";
import { Logger } from "../lib/logger";
import { Timestamp } from "firebase-admin/firestore";

/**
 * License key format regex
 * Format: CREATOR-YYYY-XXXXX-XXXXX (where X is alphanumeric uppercase)
 */
const LICENSE_KEY_REGEX = /^CREATOR-\d{4}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;

/**
 * Validation result for license key format
 */
export interface FormatValidationResult {
  valid: boolean;
  error?: string;
  code?: ErrorCode;
}

/**
 * License validation result
 */
export interface LicenseValidationResult {
  success: boolean;
  license?: License;
  error?: string;
  code?: ErrorCode;
}

/**
 * Complete validation response
 */
export type ValidationResponse =
  | ValidateLicenseSuccessResponse
  | ValidateLicenseErrorResponse;

/**
 * Validates the format of a license key
 *
 * @param {string} licenseKey - The license key to validate
 * @returns {FormatValidationResult} Validation result
 *
 * @example
 * ```typescript
 * const result = validateLicenseKeyFormat("CREATOR-2024-ABCDE-FGHIJ");
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateLicenseKeyFormat(
  licenseKey: string
): FormatValidationResult {
  if (!licenseKey || typeof licenseKey !== "string") {
    return {
      valid: false,
      error: "License key is required",
      code: "INVALID_FORMAT",
    };
  }

  const trimmedKey = licenseKey.trim().toUpperCase();

  if (!LICENSE_KEY_REGEX.test(trimmedKey)) {
    return {
      valid: false,
      error: "Invalid license key format. Expected: CREATOR-YYYY-XXXXX-XXXXX",
      code: "INVALID_FORMAT",
    };
  }

  return { valid: true };
}

/**
 * Validates the site URL format
 *
 * @param {string} siteUrl - The site URL to validate
 * @returns {FormatValidationResult} Validation result
 */
export function validateSiteUrlFormat(siteUrl: string): FormatValidationResult {
  if (!siteUrl || typeof siteUrl !== "string") {
    return {
      valid: false,
      error: "Site URL is required",
      code: "INVALID_FORMAT",
    };
  }

  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        valid: false,
        error: "Site URL must use http or https protocol",
        code: "INVALID_FORMAT",
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: "Invalid site URL format",
      code: "INVALID_FORMAT",
    };
  }
}

/**
 * Validates a license against all business rules
 *
 * @param {License} license - The license to validate
 * @param {string} requestedSiteUrl - The site URL from the request
 * @returns {LicenseValidationResult} Validation result
 */
export function validateLicenseState(
  license: License,
  requestedSiteUrl: string
): LicenseValidationResult {
  // Check status
  if (license.status === "suspended") {
    return {
      success: false,
      error: "License has been suspended",
      code: "LICENSE_SUSPENDED",
    };
  }

  if (license.status === "expired") {
    return {
      success: false,
      error: "License has expired",
      code: "LICENSE_EXPIRED",
    };
  }

  // Check expiration date
  if (isTimestampExpired(license.expires_at)) {
    return {
      success: false,
      error: "License has expired",
      code: "LICENSE_EXPIRED",
    };
  }

  // Check site URL match (normalize both URLs for comparison)
  const normalizedLicenseUrl = normalizeSiteUrl(license.site_url);
  const normalizedRequestUrl = normalizeSiteUrl(requestedSiteUrl);

  if (normalizedLicenseUrl !== normalizedRequestUrl) {
    return {
      success: false,
      error: "Site URL does not match registered URL",
      code: "URL_MISMATCH",
    };
  }

  // Check quota
  if (license.tokens_used >= license.tokens_limit) {
    return {
      success: false,
      error: "Token quota exceeded",
      code: "QUOTA_EXCEEDED",
    };
  }

  return { success: true, license };
}

/**
 * Normalizes a site URL for comparison
 *
 * @param {string} url - The URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeSiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, lowercase hostname
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Processes a license validation request
 *
 * @param {ValidateLicenseRequest} request - The validation request
 * @param {string} jwtSecret - JWT secret for token generation
 * @param {string} ipAddress - Client IP address
 * @param {Logger} logger - Logger instance
 * @returns {Promise<ValidationResponse>} Validation response
 *
 * @example
 * ```typescript
 * const response = await processLicenseValidation(
 *   { license_key: "CREATOR-2024-ABCDE-FGHIJ", site_url: "https://mysite.com" },
 *   jwtSecret.value(),
 *   "192.168.1.1",
 *   logger
 * );
 * ```
 */
export async function processLicenseValidation(
  request: ValidateLicenseRequest,
  jwtSecret: string,
  ipAddress: string,
  logger: Logger
): Promise<ValidationResponse> {
  const { license_key, site_url } = request;

  // Validate license key format
  const keyValidation = validateLicenseKeyFormat(license_key);
  if (!keyValidation.valid) {
    await logValidationFailure(license_key, ipAddress, keyValidation.code!, keyValidation.error!);
    return createErrorResponse(keyValidation.code!, keyValidation.error!);
  }

  // Validate site URL format
  const urlValidation = validateSiteUrlFormat(site_url);
  if (!urlValidation.valid) {
    await logValidationFailure(license_key, ipAddress, urlValidation.code!, urlValidation.error!);
    return createErrorResponse(urlValidation.code!, urlValidation.error!);
  }

  // Normalize the license key
  const normalizedKey = license_key.trim().toUpperCase();

  // Fetch license from Firestore
  const license = await getLicenseByKey(normalizedKey);

  if (!license) {
    logger.warn("License not found", { license_key: normalizedKey });
    await logValidationFailure(normalizedKey, ipAddress, "LICENSE_NOT_FOUND", "License not found");
    return createErrorResponse("LICENSE_NOT_FOUND", "License not found");
  }

  // Validate license state
  const stateValidation = validateLicenseState(license, site_url);
  if (!stateValidation.success) {
    logger.warn("License validation failed", {
      license_key: normalizedKey,
      reason: stateValidation.code,
    });
    await logValidationFailure(
      normalizedKey,
      ipAddress,
      stateValidation.code!,
      stateValidation.error!
    );
    return createErrorResponse(stateValidation.code!, stateValidation.error!);
  }

  // Generate or reuse site_token
  let siteToken = license.site_token;
  let needsNewToken = !siteToken;

  // Check if existing token is expired
  if (siteToken) {
    const decoded = decodeToken(siteToken);
    if (!decoded || isTokenExpired(decoded)) {
      logger.info("Existing token is expired, generating new one", { license_key: normalizedKey });
      needsNewToken = true;
    }
  }

  if (needsNewToken) {
    // Generate new JWT
    siteToken = generateToken(
      {
        license_id: normalizedKey,
        site_url: license.site_url,
        plan: license.plan,
      },
      jwtSecret
    );

    // Save the token to the license
    await updateLicense(normalizedKey, {
      site_token: siteToken,
      updated_at: Timestamp.now(),
    });

    logger.info("Generated new site_token", { license_key: normalizedKey });
  }

  // Log successful validation
  await createAuditLog({
    license_id: normalizedKey,
    request_type: "license_validation",
    status: "success",
    ip_address: ipAddress,
  });

  logger.info("License validated successfully", {
    license_key: normalizedKey,
    plan: license.plan,
  });

  // Calculate remaining tokens
  const tokensRemaining = license.tokens_limit - license.tokens_used;

  return {
    success: true,
    user_id: license.user_id,
    site_token: siteToken!, // Always defined: either existing valid token or newly generated
    plan: license.plan,
    tokens_limit: license.tokens_limit,
    tokens_remaining: tokensRemaining,
    reset_date: timestampToISO(license.reset_date).split("T")[0],
  };
}

/**
 * Creates an error response
 *
 * @param {ErrorCode} code - Error code
 * @param {string} error - Error message
 * @returns {ValidateLicenseErrorResponse} Error response
 */
function createErrorResponse(
  code: ErrorCode,
  error: string
): ValidateLicenseErrorResponse {
  return {
    success: false,
    error,
    code,
  };
}

/**
 * Logs a validation failure to audit logs
 *
 * @param {string} licenseKey - The license key
 * @param {string} ipAddress - Client IP address
 * @param {string} errorCode - Error code
 * @param {string} errorMessage - Error message
 */
async function logValidationFailure(
  licenseKey: string,
  ipAddress: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  try {
    await createAuditLog({
      license_id: licenseKey,
      request_type: "license_validation",
      status: "failed",
      error_message: `${errorCode}: ${errorMessage}`,
      ip_address: ipAddress,
    });
  } catch {
    // Silently fail audit logging - don't break the main flow
  }
}
