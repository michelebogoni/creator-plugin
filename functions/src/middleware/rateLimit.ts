/**
 * @fileoverview Rate limiting middleware for Creator AI Proxy
 * @module middleware/rateLimit
 *
 * @description
 * Provides rate limiting with multiple strategy support:
 * - "memory": In-memory counters (default, best for MVP/single instance)
 * - "firestore": Firestore-based counters (legacy, distributed)
 * - "redis": Redis-based counters (future, for horizontal scaling)
 */

import { Request, Response } from "express";
import { checkAndIncrementRateLimit } from "../lib/firestore";
import { Logger } from "../lib/logger";
import { ERROR_MESSAGE_MAP, ERROR_STATUS_MAP } from "../types/Auth";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Rate limiting strategy
 * @enum {string}
 */
export enum RateLimitStrategy {
  /** In-memory counters (default for MVP, single instance) */
  MEMORY = "memory",
  /** Firestore-based counters (legacy, distributed but higher latency) */
  FIRESTORE = "firestore",
  /** Redis-based counters (future, for horizontal scaling) */
  REDIS = "redis",
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds?: number;
  /** Endpoint identifier for the rate limiter */
  endpoint: string;
  /** Rate limiting strategy to use */
  strategy?: RateLimitStrategy;
}

/**
 * In-memory counter structure
 */
interface Counter {
  /** Current request count in the window */
  count: number;
  /** Window start timestamp in milliseconds */
  windowStart: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current request count */
  count: number;
  /** Seconds until window resets */
  resetIn?: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the rate limiting strategy from environment
 * @returns {RateLimitStrategy} The configured strategy
 */
export function getRateLimitStrategy(): RateLimitStrategy {
  const envStrategy = process.env.RATE_LIMIT_STRATEGY?.toLowerCase();

  switch (envStrategy) {
    case "firestore":
      return RateLimitStrategy.FIRESTORE;
    case "redis":
      return RateLimitStrategy.REDIS;
    case "memory":
    default:
      return RateLimitStrategy.MEMORY;
  }
}

/**
 * Default rate limit configuration
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
  endpoint: "default",
  strategy: getRateLimitStrategy(),
};

// ============================================================================
// In-Memory Rate Limiter
// ============================================================================

/**
 * In-memory storage for rate limit counters
 * Key format: `${identifier}:${endpoint}` where identifier is license_id or IP
 */
const inMemoryCounters = new Map<string, Counter>();

/**
 * Cleanup interval for expired counters (5 minutes)
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Maximum age for counters before cleanup (10 minutes)
 */
const MAX_COUNTER_AGE_MS = 10 * 60 * 1000;

/**
 * Periodically cleanup expired counters to prevent memory leaks
 */
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the cleanup interval for in-memory counters
 */
export function startCleanupInterval(): void {
  if (cleanupIntervalId) return;

  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, counter] of inMemoryCounters.entries()) {
      if (now - counter.windowStart > MAX_COUNTER_AGE_MS) {
        inMemoryCounters.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      // Log cleanup in production if needed
      // console.log(`Rate limit cleanup: removed ${cleaned} expired counters`);
    }
  }, CLEANUP_INTERVAL_MS);

  // Prevent the interval from keeping the process alive
  if (cleanupIntervalId.unref) {
    cleanupIntervalId.unref();
  }
}

/**
 * Stop the cleanup interval (useful for testing)
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

/**
 * Clear all in-memory counters (useful for testing)
 */
export function clearInMemoryCounters(): void {
  inMemoryCounters.clear();
}

/**
 * Get the current counter count for a key (useful for testing)
 */
export function getCounterCount(key: string): number {
  return inMemoryCounters.get(key)?.count ?? 0;
}

/**
 * Build the rate limit key
 *
 * @param {string} identifier - The license_id or IP address
 * @param {string} endpoint - The endpoint identifier
 * @returns {string} The composite key
 */
export function buildRateLimitKey(identifier: string, endpoint: string): string {
  return `${identifier}:${endpoint}`;
}

/**
 * Check and increment rate limit using in-memory storage
 *
 * @param {string} key - The rate limit key (license_id:endpoint or ip:endpoint)
 * @param {number} maxRequests - Maximum requests allowed per window
 * @param {number} windowSeconds - Window size in seconds
 * @returns {RateLimitResult} The rate limit check result
 *
 * @description
 * Implements a fixed-window rate limiting algorithm:
 * - If the current window has expired, reset the counter
 * - If under the limit, increment and allow
 * - If at or over the limit, deny the request
 */
export function checkRateLimitInMemory(
  key: string,
  maxRequests: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  let counter = inMemoryCounters.get(key);

  // Check if we need to start a new window
  if (!counter || now - counter.windowStart >= windowMs) {
    // Start a new window
    counter = {
      count: 1,
      windowStart: now,
    };
    inMemoryCounters.set(key, counter);

    return {
      allowed: true,
      count: 1,
      resetIn: windowSeconds,
    };
  }

  // Calculate time until window resets
  const resetIn = Math.ceil((counter.windowStart + windowMs - now) / 1000);

  // Check if under limit
  if (counter.count < maxRequests) {
    counter.count++;
    return {
      allowed: true,
      count: counter.count,
      resetIn,
    };
  }

  // Rate limited
  return {
    allowed: false,
    count: counter.count,
    resetIn,
  };
}

// Start cleanup interval on module load
startCleanupInterval();

/**
 * Extracts the client IP address from a request
 *
 * @param {Request} req - The incoming request
 * @returns {string} The client IP address
 *
 * @description
 * Attempts to get the real client IP from various headers (for proxied requests)
 * Falls back to socket remote address if headers not present
 */
export function getClientIP(req: Request): string {
  // Check X-Forwarded-For header (common with proxies/load balancers)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first (client)
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips.trim();
  }

  // Check X-Real-IP header
  const realIP = req.headers["x-real-ip"];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  // Fallback to socket remote address
  return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * Checks rate limit for a request using IP address (for unauthenticated endpoints)
 *
 * @param {Request} req - The incoming request
 * @param {RateLimitConfig} config - Rate limit configuration
 * @param {Logger} logger - Logger instance
 * @returns {Promise<RateLimitResult>} Rate limit check result
 *
 * @example
 * ```typescript
 * const result = await checkRateLimit(req, {
 *   maxRequests: 10,
 *   endpoint: "validate_license"
 * }, logger);
 *
 * if (!result.allowed) {
 *   return res.status(429).json({ error: "Rate limited" });
 * }
 * ```
 */
export async function checkRateLimit(
  req: Request,
  config: RateLimitConfig,
  logger: Logger
): Promise<RateLimitResult> {
  const ipAddress = getClientIP(req);
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const { maxRequests, windowSeconds, endpoint, strategy } = finalConfig;

  const key = buildRateLimitKey(ipAddress, endpoint);

  return checkRateLimitByStrategy(
    key,
    maxRequests,
    windowSeconds!,
    strategy!,
    logger,
    { ip_address: ipAddress, endpoint }
  );
}

/**
 * Checks rate limit for authenticated requests using license_id
 *
 * @param {string} licenseId - The license ID from JWT claims
 * @param {RateLimitConfig} config - Rate limit configuration
 * @param {Logger} logger - Logger instance
 * @returns {Promise<RateLimitResult>} Rate limit check result
 *
 * @example
 * ```typescript
 * const result = await checkRateLimitByLicense(claims.license_id, {
 *   maxRequests: 100,
 *   endpoint: "route_request"
 * }, logger);
 *
 * if (!result.allowed) {
 *   return res.status(429).json({ error: "Rate limited" });
 * }
 * ```
 */
export async function checkRateLimitByLicense(
  licenseId: string,
  config: RateLimitConfig,
  logger: Logger
): Promise<RateLimitResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const { maxRequests, windowSeconds, endpoint, strategy } = finalConfig;

  const key = buildRateLimitKey(licenseId, endpoint);

  return checkRateLimitByStrategy(
    key,
    maxRequests,
    windowSeconds!,
    strategy!,
    logger,
    { license_id: licenseId, endpoint }
  );
}

/**
 * Internal function to check rate limit by strategy
 *
 * @param {string} key - The rate limit key
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowSeconds - Window size in seconds
 * @param {RateLimitStrategy} strategy - The strategy to use
 * @param {Logger} logger - Logger instance
 * @param {Record<string, string>} logContext - Additional context for logging
 * @returns {Promise<RateLimitResult>} Rate limit check result
 */
async function checkRateLimitByStrategy(
  key: string,
  maxRequests: number,
  windowSeconds: number,
  strategy: RateLimitStrategy,
  logger: Logger,
  logContext: Record<string, string>
): Promise<RateLimitResult> {
  try {
    let result: RateLimitResult;

    switch (strategy) {
      case RateLimitStrategy.MEMORY:
        result = checkRateLimitInMemory(key, maxRequests, windowSeconds);
        break;

      case RateLimitStrategy.FIRESTORE: {
        // Extract identifier and endpoint from key for Firestore
        const [identifier, endpoint] = key.split(":");
        const { limited, count } = await checkAndIncrementRateLimit(
          endpoint,
          identifier,
          maxRequests
        );
        result = {
          allowed: !limited,
          count,
          resetIn: windowSeconds,
        };
        break;
      }

      case RateLimitStrategy.REDIS:
        // Future: implement Redis-based rate limiting
        logger.warn("Redis rate limiting not yet implemented, falling back to memory", logContext);
        result = checkRateLimitInMemory(key, maxRequests, windowSeconds);
        break;

      default:
        result = checkRateLimitInMemory(key, maxRequests, windowSeconds);
    }

    if (!result.allowed) {
      logger.warn("Rate limit exceeded", {
        ...logContext,
        count: result.count,
        limit: maxRequests,
        strategy,
      });
    }

    return result;
  } catch (error) {
    // On error, allow the request but log the issue
    logger.error("Rate limit check failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      ...logContext,
      strategy,
    });
    // Fail open - allow request if rate limiter is broken
    return { allowed: true, count: 0 };
  }
}

/**
 * Sends a rate limit error response
 *
 * @param {Response} res - The response object
 * @param {number} retryAfter - Seconds until rate limit resets
 * @returns {void}
 */
export function sendRateLimitResponse(
  res: Response,
  retryAfter: number = 60
): void {
  res.setHeader("Retry-After", retryAfter.toString());
  res.setHeader("X-RateLimit-Reset", new Date(Date.now() + retryAfter * 1000).toISOString());

  res.status(ERROR_STATUS_MAP.RATE_LIMITED).json({
    success: false,
    error: ERROR_MESSAGE_MAP.RATE_LIMITED,
    code: "RATE_LIMITED",
  });
}

/**
 * Rate limiting middleware factory (IP-based, for unauthenticated endpoints)
 *
 * @param {Partial<RateLimitConfig>} config - Rate limit configuration
 * @returns {Function} Express-style middleware function
 *
 * @example
 * ```typescript
 * const rateLimiter = createRateLimitMiddleware({
 *   maxRequests: 10,
 *   endpoint: "validate_license"
 * });
 *
 * // In your handler:
 * const rateLimitResult = await rateLimiter(req, res, logger);
 * if (!rateLimitResult.continue) return;
 * ```
 */
export function createRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async (
    req: Request,
    res: Response,
    logger: Logger
  ): Promise<{ continue: boolean }> => {
    const result = await checkRateLimit(req, finalConfig, logger);

    return handleRateLimitResult(res, result, finalConfig.maxRequests);
  };
}

/**
 * Rate limiting middleware factory (license-based, for authenticated endpoints)
 *
 * @param {Partial<RateLimitConfig>} config - Rate limit configuration
 * @returns {Function} Middleware function that takes license_id
 *
 * @example
 * ```typescript
 * const rateLimiter = createLicenseRateLimitMiddleware({
 *   maxRequests: 100,
 *   endpoint: "route_request"
 * });
 *
 * // In your handler (after authentication):
 * const rateLimitResult = await rateLimiter(claims.license_id, res, logger);
 * if (!rateLimitResult.continue) return;
 * ```
 */
export function createLicenseRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async (
    licenseId: string,
    res: Response,
    logger: Logger
  ): Promise<{ continue: boolean }> => {
    const result = await checkRateLimitByLicense(licenseId, finalConfig, logger);

    return handleRateLimitResult(res, result, finalConfig.maxRequests);
  };
}

/**
 * Handle rate limit result and set appropriate headers/response
 *
 * @param {Response} res - Express response object
 * @param {RateLimitResult} result - Rate limit check result
 * @param {number} maxRequests - Maximum requests allowed
 * @returns {{ continue: boolean }} Whether to continue processing
 */
function handleRateLimitResult(
  res: Response,
  result: RateLimitResult,
  maxRequests: number
): { continue: boolean } {
  const { allowed, count, resetIn } = result;

  // Always add rate limit headers
  res.setHeader("X-RateLimit-Limit", maxRequests.toString());
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(0, maxRequests - count).toString()
  );
  res.setHeader("X-RateLimit-Count", count.toString());

  if (resetIn !== undefined) {
    res.setHeader("X-RateLimit-Reset-In", resetIn.toString());
  }

  if (!allowed) {
    sendRateLimitResponse(res, resetIn);
    return { continue: false };
  }

  return { continue: true };
}
