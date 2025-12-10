/**
 * @fileoverview Route request/response type definitions for AI routing
 * @module types/Route
 *
 * @description
 * Defines types for the smart router endpoint that handles
 * AI generation requests with automatic provider fallback.
 */

import { ProviderName, FileAttachment } from "./AIProvider";

/**
 * Supported task types for AI routing
 *
 * @description
 * Each task type maps to a specific routing configuration:
 * - TEXT_GEN: Articles, descriptions - prioritizes speed/cost
 * - CODE_GEN: Code generation - prioritizes quality
 * - DESIGN_GEN: Layout/design - prioritizes context window
 * - ECOMMERCE_GEN: Product descriptions - prioritizes context window
 */
export type TaskType = "TEXT_GEN" | "CODE_GEN" | "DESIGN_GEN" | "ECOMMERCE_GEN";

/**
 * Request body for the route-request endpoint
 *
 * @interface RouteRequest
 */
export interface RouteRequest {
  /**
   * Type of AI task to perform
   */
  task_type: TaskType;

  /**
   * The prompt to send to the AI provider
   * Must be non-empty and under 10000 characters
   */
  prompt: string;

  /**
   * Selected AI model
   * - 'claude': Claude Opus 4 (Anthropic) - Primary
   * - 'gemini': Gemini Pro (Google) - Fallback
   * Each model falls back to the other if unavailable
   */
  model?: "gemini" | "claude";

  /**
   * Optional context about the requesting site
   * Can include site_title, theme, plugins, etc.
   */
  context?: Record<string, unknown>;

  /**
   * Optional system prompt override
   */
  system_prompt?: string;

  /**
   * Optional temperature override (0-1)
   */
  temperature?: number;

  /**
   * Optional max tokens override
   */
  max_tokens?: number;

  /**
   * Chat session ID for model locking
   */
  chat_id?: string;

  /**
   * File attachments for multimodal requests
   * Supports images (JPEG, PNG, GIF, WebP), PDFs, and documents
   */
  files?: FileAttachment[];

  /**
   * Additional options passed from WordPress
   * May contain files under options.files for backwards compatibility
   */
  options?: {
    files?: FileAttachment[];
    [key: string]: unknown;
  };
}

/**
 * Successful response from route-request endpoint
 *
 * @interface RouteResponseSuccess
 */
export interface RouteResponseSuccess {
  /** Always true for success */
  success: true;

  /** Generated content */
  content: string;

  /** Provider that handled the request */
  provider: ProviderName;

  /** Specific model used */
  model: string;

  /** Total tokens used (input + output) */
  tokens_used: number;

  /** Cost in USD */
  cost_usd: number;

  /** Response latency in milliseconds */
  latency_ms: number;
}

/**
 * Error response from route-request endpoint
 *
 * @interface RouteResponseError
 */
export interface RouteResponseError {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code */
  code: string;
}

/**
 * Union type for route responses
 */
export type RouteResponse = RouteResponseSuccess | RouteResponseError;

/**
 * Routing configuration for a provider
 *
 * @interface ProviderRouteConfig
 */
export interface ProviderRouteConfig {
  /** Provider name */
  provider: ProviderName;

  /** Model to use */
  model: string;
}

/**
 * Routing matrix entry for a task type
 *
 * @interface TaskRouteConfig
 */
export interface TaskRouteConfig {
  /** Primary provider to try first */
  primary: ProviderRouteConfig;

  /** First fallback if primary fails */
  fallback1: ProviderRouteConfig;

  /** Second fallback if first fallback fails */
  fallback2: ProviderRouteConfig;
}

/**
 * Complete routing matrix mapping task types to provider chains
 */
export type RoutingMatrix = Record<TaskType, TaskRouteConfig>;

/**
 * Default routing matrix
 *
 * @description
 * All task types use the same two-provider configuration:
 * - Primary: Claude Opus 4 (highest quality)
 * - Fallback: Gemini Pro (backup when Claude is unavailable)
 *
 * This simplified routing ensures consistent quality across all task types
 * while maintaining reliability through automatic fallback.
 */
export const DEFAULT_ROUTING_MATRIX: RoutingMatrix = {
  TEXT_GEN: {
    primary: { provider: "claude", model: "claude-opus-4-5-20251101" },
    fallback1: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
    fallback2: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
  },
  CODE_GEN: {
    primary: { provider: "claude", model: "claude-opus-4-5-20251101" },
    fallback1: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
    fallback2: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
  },
  DESIGN_GEN: {
    primary: { provider: "claude", model: "claude-opus-4-5-20251101" },
    fallback1: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
    fallback2: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
  },
  ECOMMERCE_GEN: {
    primary: { provider: "claude", model: "claude-opus-4-5-20251101" },
    fallback1: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
    fallback2: { provider: "gemini", model: "gemini-2.5-pro-preview-05-06" },
  },
};

/**
 * Valid task types for validation
 */
export const VALID_TASK_TYPES: TaskType[] = [
  "TEXT_GEN",
  "CODE_GEN",
  "DESIGN_GEN",
  "ECOMMERCE_GEN",
];

/**
 * Checks if a string is a valid task type
 *
 * @param {string} taskType - The task type to validate
 * @returns {boolean} True if valid
 */
export function isValidTaskType(taskType: string): taskType is TaskType {
  return VALID_TASK_TYPES.includes(taskType as TaskType);
}

/**
 * Maximum prompt length in characters
 * Safety ceiling - actual prompts should be much smaller due to compression
 */
export const MAX_PROMPT_LENGTH = 100000;

/**
 * Minimum quota threshold for warnings
 */
export const LOW_QUOTA_WARNING_THRESHOLD = 1000;

/**
 * Minimum quota threshold for errors
 */
export const QUOTA_EXCEEDED_THRESHOLD = 100;

/**
 * Rate limit for AI requests per license per minute
 */
export const AI_RATE_LIMIT_PER_MINUTE = 100;
