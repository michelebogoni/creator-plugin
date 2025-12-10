/**
 * @fileoverview JWT generation and validation utilities
 * @module lib/jwt
 */

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import {
  JWTClaims,
  JWTPayload,
  JWTOptions,
  JWTVerifyResult,
} from "../types/JWTClaims";

/**
 * Default JWT expiration time (24 hours in seconds)
 */
const DEFAULT_EXPIRATION = 86400;

/**
 * JWT algorithm used for signing
 */
const JWT_ALGORITHM = "HS256";

/**
 * Generates a new JWT site_token
 *
 * @param {JWTPayload} payload - The payload to embed in the token
 * @param {string} secret - The secret key for signing
 * @param {JWTOptions} options - Optional configuration
 * @returns {string} The signed JWT token
 *
 * @throws {Error} If secret is empty or payload is invalid
 *
 * @example
 * ```typescript
 * const token = generateToken(
 *   {
 *     license_id: "CREATOR-2024-ABCDE-FGHIJ",
 *     site_url: "https://mysite.com",
 *     plan: "pro"
 *   },
 *   process.env.JWT_SECRET,
 *   { expiresIn: 86400 }
 * );
 * ```
 */
export function generateToken(
  payload: JWTPayload,
  secret: string,
  options: JWTOptions = {}
): string {
  if (!secret || secret.trim() === "") {
    throw new Error("JWT secret cannot be empty");
  }

  if (!payload.license_id || !payload.site_url || !payload.plan) {
    throw new Error("Invalid JWT payload: missing required fields");
  }

  const expiresIn = options.expiresIn || DEFAULT_EXPIRATION;
  const now = Math.floor(Date.now() / 1000);

  const claims: JWTClaims = {
    license_id: payload.license_id,
    site_url: payload.site_url,
    plan: payload.plan,
    iat: now,
    exp: now + expiresIn,
    jti: uuidv4(),
  };

  return jwt.sign(claims, secret, { algorithm: JWT_ALGORITHM });
}

/**
 * Verifies and decodes a JWT token
 *
 * @param {string} token - The JWT token to verify
 * @param {string} secret - The secret key for verification
 * @returns {JWTVerifyResult} Verification result with claims or error
 *
 * @example
 * ```typescript
 * const result = verifyToken(token, process.env.JWT_SECRET);
 * if (result.valid) {
 *   console.log(result.claims.license_id);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function verifyToken(token: string, secret: string): JWTVerifyResult {
  if (!token || token.trim() === "") {
    return { valid: false, error: "Token cannot be empty" };
  }

  if (!secret || secret.trim() === "") {
    return { valid: false, error: "Secret cannot be empty" };
  }

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
    }) as JWTClaims;

    // Validate required claims exist
    if (!decoded.license_id || !decoded.site_url || !decoded.plan) {
      return { valid: false, error: "Token missing required claims" };
    }

    return { valid: true, claims: decoded };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { valid: false, error: "Token has expired" };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { valid: false, error: "Invalid token" };
    }
    return { valid: false, error: "Token verification failed" };
  }
}

/**
 * Extracts the token from an Authorization header
 *
 * @param {string | undefined} authHeader - The Authorization header value
 * @returns {string | null} The extracted token or null
 *
 * @example
 * ```typescript
 * const token = extractBearerToken(req.headers.authorization);
 * if (token) {
 *   const result = verifyToken(token, secret);
 * }
 * ```
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Decodes a JWT token without verification (for inspection only)
 *
 * @param {string} token - The JWT token to decode
 * @returns {JWTClaims | null} The decoded claims or null if invalid format
 *
 * @warning This does NOT verify the token signature. Use only for inspection.
 *
 * @example
 * ```typescript
 * const claims = decodeToken(token);
 * if (claims) {
 *   console.log(`Token expires at: ${new Date(claims.exp * 1000)}`);
 * }
 * ```
 */
export function decodeToken(token: string): JWTClaims | null {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === "string") {
      return null;
    }
    return decoded as JWTClaims;
  } catch {
    return null;
  }
}

/**
 * Checks if a token is expired based on its claims
 *
 * @param {JWTClaims} claims - The decoded token claims
 * @returns {boolean} True if the token is expired
 *
 * @example
 * ```typescript
 * const claims = decodeToken(token);
 * if (claims && isTokenExpired(claims)) {
 *   console.log("Token has expired");
 * }
 * ```
 */
export function isTokenExpired(claims: JWTClaims): boolean {
  const now = Math.floor(Date.now() / 1000);
  return claims.exp < now;
}
