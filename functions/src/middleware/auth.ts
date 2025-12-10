/**
 * @fileoverview Authentication middleware for Creator AI Proxy
 * @module middleware/auth
 */

import { Request, Response } from "express";
import { extractBearerToken, verifyToken } from "../lib/jwt";
import { Logger } from "../lib/logger";
import { JWTClaims } from "../types/JWTClaims";
import { getLicenseByKey } from "../lib/firestore";

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;

  /** Decoded JWT claims if authenticated */
  claims?: JWTClaims;

  /** Error message if not authenticated */
  error?: string;

  /** Error code if not authenticated */
  code?: string;
}

/**
 * Validates the Authorization header and verifies the JWT token
 *
 * @param {Request} req - The incoming request
 * @param {string} jwtSecret - The JWT secret for verification
 * @param {Logger} logger - Logger instance
 * @returns {Promise<AuthResult>} Authentication result
 *
 * @example
 * ```typescript
 * const authResult = await authenticateRequest(req, jwtSecret.value(), logger);
 * if (!authResult.authenticated) {
 *   return res.status(401).json({
 *     success: false,
 *     error: authResult.error,
 *     code: authResult.code
 *   });
 * }
 * const { claims } = authResult;
 * ```
 */
export async function authenticateRequest(
  req: Request,
  jwtSecret: string,
  logger: Logger
): Promise<AuthResult> {
  // Extract token from Authorization header
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    logger.warn("Missing or invalid Authorization header");
    return {
      authenticated: false,
      error: "Missing or invalid Authorization header",
      code: "MISSING_AUTH",
    };
  }

  // Verify the token
  const verifyResult = verifyToken(token, jwtSecret);

  if (!verifyResult.valid || !verifyResult.claims) {
    logger.warn("Invalid JWT token", { error: verifyResult.error });
    return {
      authenticated: false,
      error: verifyResult.error || "Invalid token",
      code: "INVALID_TOKEN",
    };
  }

  const claims = verifyResult.claims;

  // Verify the license still exists and is active
  const license = await getLicenseByKey(claims.license_id);

  if (!license) {
    logger.warn("License not found for token", {
      license_id: claims.license_id,
    });
    return {
      authenticated: false,
      error: "License not found",
      code: "LICENSE_NOT_FOUND",
    };
  }

  if (license.status !== "active") {
    logger.warn("License not active", {
      license_id: claims.license_id,
      status: license.status,
    });
    return {
      authenticated: false,
      error: `License is ${license.status}`,
      code: license.status === "suspended" ? "LICENSE_SUSPENDED" : "LICENSE_EXPIRED",
    };
  }

  // Verify site_url matches
  if (license.site_url !== claims.site_url) {
    logger.warn("Site URL mismatch", {
      license_id: claims.license_id,
      token_url: claims.site_url,
      license_url: license.site_url,
    });
    return {
      authenticated: false,
      error: "Site URL mismatch",
      code: "URL_MISMATCH",
    };
  }

  logger.info("Request authenticated", {
    license_id: claims.license_id,
    plan: claims.plan,
  });

  return {
    authenticated: true,
    claims,
  };
}

/**
 * Sends an authentication error response
 *
 * @param {Response} res - The response object
 * @param {AuthResult} authResult - The authentication result
 * @returns {void}
 */
export function sendAuthErrorResponse(
  res: Response,
  authResult: AuthResult
): void {
  const statusCode = authResult.code === "MISSING_AUTH" ? 401 : 403;

  res.status(statusCode).json({
    success: false,
    error: authResult.error,
    code: authResult.code,
  });
}

/**
 * Authentication middleware factory
 *
 * @param {string} jwtSecret - The JWT secret for verification
 * @returns {Function} Middleware function
 *
 * @example
 * ```typescript
 * const authenticate = createAuthMiddleware(jwtSecret.value());
 *
 * // In your handler:
 * const authResult = await authenticate(req, res, logger);
 * if (!authResult.continue) return;
 * const { claims } = authResult;
 * ```
 */
export function createAuthMiddleware(jwtSecret: string) {
  return async (
    req: Request,
    res: Response,
    logger: Logger
  ): Promise<{ continue: boolean; claims?: JWTClaims }> => {
    const authResult = await authenticateRequest(req, jwtSecret, logger);

    if (!authResult.authenticated) {
      sendAuthErrorResponse(res, authResult);
      return { continue: false };
    }

    return { continue: true, claims: authResult.claims };
  };
}
