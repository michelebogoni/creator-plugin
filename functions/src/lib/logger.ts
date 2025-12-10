/**
 * @fileoverview Structured logging utility for Creator AI Proxy
 * @module lib/logger
 */

import * as functions from "firebase-functions";

/**
 * Log levels supported by the logger
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Context data for structured logs
 */
export interface LogContext {
  /** Request ID for tracing */
  request_id?: string;

  /** License ID being processed */
  license_id?: string;

  /** Site URL making the request */
  site_url?: string;

  /** Client IP address */
  ip_address?: string;

  /** Endpoint being called */
  endpoint?: string;

  /** AI provider used */
  provider?: string;

  /** Job ID for async tasks */
  job_id?: string;

  /** Additional context data */
  [key: string]: unknown;
}

/**
 * Structured log entry
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
}

/**
 * Logger class for structured logging
 *
 * @class Logger
 * @description Provides consistent structured logging across all functions
 *
 * @example
 * ```typescript
 * const logger = new Logger({ endpoint: "/api/auth/validate-license" });
 * logger.info("License validated", { license_id: "lic_123" });
 * logger.error("Validation failed", { error: "License expired" });
 * ```
 */
export class Logger {
  private baseContext: LogContext;

  /**
   * Creates a new Logger instance
   *
   * @param {LogContext} baseContext - Default context to include in all logs
   */
  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext;
  }

  /**
   * Creates a child logger with additional context
   *
   * @param {LogContext} additionalContext - Additional context to merge
   * @returns {Logger} New logger instance with merged context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...additionalContext });
  }

  /**
   * Formats a log entry as structured JSON
   *
   * @param {LogLevel} level - Log level
   * @param {string} message - Log message
   * @param {LogContext} context - Additional context
   * @returns {LogEntry} Formatted log entry
   */
  private formatEntry(
    level: LogLevel,
    message: string,
    context: LogContext = {}
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...context },
    };
  }

  /**
   * Logs a debug message
   *
   * @param {string} message - Log message
   * @param {LogContext} context - Additional context
   */
  debug(message: string, context: LogContext = {}): void {
    const entry = this.formatEntry("debug", message, context);
    functions.logger.debug(entry);
  }

  /**
   * Logs an info message
   *
   * @param {string} message - Log message
   * @param {LogContext} context - Additional context
   */
  info(message: string, context: LogContext = {}): void {
    const entry = this.formatEntry("info", message, context);
    functions.logger.info(entry);
  }

  /**
   * Logs a warning message
   *
   * @param {string} message - Log message
   * @param {LogContext} context - Additional context
   */
  warn(message: string, context: LogContext = {}): void {
    const entry = this.formatEntry("warn", message, context);
    functions.logger.warn(entry);
  }

  /**
   * Logs an error message
   *
   * @param {string} message - Log message
   * @param {LogContext} context - Additional context (can include Error object)
   */
  error(message: string, context: LogContext = {}): void {
    // If context contains an Error, extract useful info
    if (context.error instanceof Error) {
      context = {
        ...context,
        error_name: context.error.name,
        error_message: context.error.message,
        error_stack: context.error.stack,
      };
      delete context.error;
    }
    const entry = this.formatEntry("error", message, context);
    functions.logger.error(entry);
  }
}

/**
 * Default logger instance for general use
 */
export const logger = new Logger();

/**
 * Creates a new Logger instance (factory function)
 *
 * @param {LogContext} context - Initial context
 * @returns {Logger} New logger instance
 *
 * @example
 * ```typescript
 * const log = createLogger().child({ job_id: "job_123" });
 * log.info("Processing job");
 * ```
 */
export function createLogger(context: LogContext = {}): Logger {
  return new Logger(context);
}

/**
 * Creates a request-scoped logger
 *
 * @param {string} requestId - Unique request identifier
 * @param {string} endpoint - Endpoint being called
 * @param {string} ipAddress - Client IP address
 * @returns {Logger} Logger instance with request context
 *
 * @example
 * ```typescript
 * const reqLogger = createRequestLogger("req_123", "/api/auth/validate-license", "192.168.1.1");
 * reqLogger.info("Processing request");
 * ```
 */
export function createRequestLogger(
  requestId: string,
  endpoint: string,
  ipAddress: string
): Logger {
  return new Logger({
    request_id: requestId,
    endpoint,
    ip_address: ipAddress,
  });
}
