/**
 * @fileoverview POST /api/auth/validate-license endpoint
 * @module api/auth/validateLicense
 */

import { onRequest } from "firebase-functions/v2/https";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { jwtSecret } from "../../lib/secrets";
import { createRequestLogger } from "../../lib/logger";
import { createRateLimitMiddleware, getClientIP } from "../../middleware/rateLimit";
import { processLicenseValidation } from "../../services/licensing";
import {
  ValidateLicenseRequest,
  ERROR_STATUS_MAP,
  ERROR_MESSAGE_MAP,
} from "../../types/Auth";

/**
 * Rate limiter for validate-license endpoint
 * Max 10 requests per minute per IP
 */
const rateLimiter = createRateLimitMiddleware({
  endpoint: "validate_license",
  maxRequests: 10,
});

/**
 * Validates incoming request body
 *
 * @param {unknown} body - Request body
 * @returns {{ valid: boolean; data?: ValidateLicenseRequest; error?: string }}
 */
function validateRequestBody(
  body: unknown
): { valid: boolean; data?: ValidateLicenseRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body is required" };
  }

  const { license_key, site_url } = body as Record<string, unknown>;

  if (!license_key || typeof license_key !== "string") {
    return { valid: false, error: "license_key is required" };
  }

  if (!site_url || typeof site_url !== "string") {
    return { valid: false, error: "site_url is required" };
  }

  return {
    valid: true,
    data: {
      license_key: license_key.trim(),
      site_url: site_url.trim(),
    },
  };
}

/**
 * Handles the license validation request
 *
 * @param {Request} req - Firebase Functions request
 * @param {Response} res - Firebase Functions response
 * @returns {Promise<void>}
 */
async function handleValidateLicense(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4();
  const ipAddress = getClientIP(req);
  const logger = createRequestLogger(
    requestId,
    "/api/auth/validate-license",
    ipAddress
  );

  logger.info("Received license validation request");

  // Set CORS headers for WordPress integration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Request-ID", requestId);

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Only allow POST method
  if (req.method !== "POST") {
    logger.warn("Invalid HTTP method", { method: req.method });
    res.status(ERROR_STATUS_MAP.INVALID_METHOD).json({
      success: false,
      error: ERROR_MESSAGE_MAP.INVALID_METHOD,
      code: "INVALID_METHOD",
    });
    return;
  }

  // Check rate limit
  const rateLimitResult = await rateLimiter(req, res, logger);
  if (!rateLimitResult.continue) {
    return; // Response already sent by rate limiter
  }

  // Validate request body
  const bodyValidation = validateRequestBody(req.body);
  if (!bodyValidation.valid) {
    logger.warn("Invalid request body", { error: bodyValidation.error });
    res.status(ERROR_STATUS_MAP.MISSING_FIELDS).json({
      success: false,
      error: bodyValidation.error || ERROR_MESSAGE_MAP.MISSING_FIELDS,
      code: "MISSING_FIELDS",
    });
    return;
  }

  const requestData = bodyValidation.data!;
  logger.info("Processing validation", {
    license_key: requestData.license_key.substring(0, 12) + "...",
    site_url: requestData.site_url,
  });

  try {
    // Get JWT secret
    const secret = jwtSecret.value();
    if (!secret) {
      logger.error("JWT_SECRET not configured");
      res.status(ERROR_STATUS_MAP.INTERNAL_ERROR).json({
        success: false,
        error: ERROR_MESSAGE_MAP.INTERNAL_ERROR,
        code: "INTERNAL_ERROR",
      });
      return;
    }

    // Process the validation
    const result = await processLicenseValidation(
      requestData,
      secret,
      ipAddress,
      logger
    );

    // Determine HTTP status code
    const statusCode = result.success
      ? 200
      : ERROR_STATUS_MAP[result.code as keyof typeof ERROR_STATUS_MAP] || 500;

    res.status(statusCode).json(result);
  } catch (error) {
    logger.error("Unexpected error during validation", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(ERROR_STATUS_MAP.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_MESSAGE_MAP.INTERNAL_ERROR,
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * Cloud Function: POST /api/auth/validate-license
 *
 * Validates a license key and returns authentication token if valid.
 *
 * @description
 * This endpoint is called by WordPress sites to validate their license
 * and obtain a JWT token for subsequent API calls.
 *
 * @example
 * Request:
 * ```json
 * POST /api/auth/validate-license
 * Content-Type: application/json
 *
 * {
 *   "license_key": "CREATOR-2024-ABCDE-FGHIJ",
 *   "site_url": "https://mysite.com"
 * }
 * ```
 *
 * Success Response (200):
 * ```json
 * {
 *   "success": true,
 *   "user_id": "user_123",
 *   "site_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "plan": "pro",
 *   "tokens_limit": 50000000,
 *   "tokens_remaining": 47654322,
 *   "reset_date": "2025-12-01"
 * }
 * ```
 *
 * Error Response (4xx/5xx):
 * ```json
 * {
 *   "success": false,
 *   "error": "License expired",
 *   "code": "LICENSE_EXPIRED"
 * }
 * ```
 */
export const validateLicense = onRequest(
  {
    secrets: [jwtSecret],
    region: "europe-west1",
    cors: true,
    maxInstances: 100,
  },
  handleValidateLicense
);
