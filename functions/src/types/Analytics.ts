/**
 * @fileoverview Analytics and Cost Tracking type definitions
 * @module types/Analytics
 *
 * @description
 * Defines types for cost tracking, analytics responses, and
 * dashboard-ready data structures.
 */

import { ProviderName } from "./AIProvider";
import { TaskType } from "./Route";

/**
 * Cost tracking document stored in Firestore
 *
 * @interface CostTrackingDocument
 *
 * @description
 * Represents a monthly cost tracking record for a license.
 * Document ID format: {license_id}_{YYYY-MM}
 */
export interface CostTrackingDocument {
  /** License ID reference */
  license_id: string;

  /** Month in YYYY-MM format */
  month: string;

  /** OpenAI input tokens consumed */
  openai_tokens_input: number;

  /** OpenAI output tokens generated */
  openai_tokens_output: number;

  /** OpenAI cost in USD */
  openai_cost_usd: number;

  /** Gemini input tokens consumed */
  gemini_tokens_input: number;

  /** Gemini output tokens generated */
  gemini_tokens_output: number;

  /** Gemini cost in USD */
  gemini_cost_usd: number;

  /** Claude input tokens consumed */
  claude_tokens_input: number;

  /** Claude output tokens generated */
  claude_tokens_output: number;

  /** Claude cost in USD */
  claude_cost_usd: number;

  /** Total cost across all providers in USD */
  total_cost_usd: number;
}

/**
 * Provider breakdown for analytics
 *
 * @interface ProviderBreakdown
 */
export interface ProviderBreakdown {
  /** Total tokens used (input + output) */
  tokens: number;

  /** Input tokens consumed */
  tokens_input: number;

  /** Output tokens generated */
  tokens_output: number;

  /** Cost in USD */
  cost: number;

  /** Number of requests */
  requests: number;
}

/**
 * Task type breakdown for analytics
 *
 * @interface TaskBreakdown
 */
export interface TaskBreakdown {
  /** Number of requests for this task type */
  requests: number;

  /** Total tokens used */
  tokens: number;

  /** Cost in USD */
  cost: number;
}

/**
 * Analytics response structure
 *
 * @interface AnalyticsResponse
 *
 * @description
 * Dashboard-ready analytics data for a license/period.
 * Includes totals and breakdowns by provider and task type.
 */
export interface AnalyticsResponse {
  /** Period in YYYY-MM format */
  period: string;

  /** License ID */
  license_id: string;

  /** Total number of requests */
  total_requests: number;

  /** Total tokens consumed (input + output) */
  total_tokens: number;

  /** Total cost in USD */
  total_cost: number;

  /** Breakdown by provider */
  breakdown_by_provider: Record<ProviderName, ProviderBreakdown>;

  /** Breakdown by task type */
  breakdown_by_task: Record<TaskType, TaskBreakdown>;
}

/**
 * Cost summary for a license
 *
 * @interface CostSummary
 */
export interface CostSummary {
  /** License ID */
  license_id: string;

  /** Period covered */
  period: string;

  /** Total tokens used */
  total_tokens: number;

  /** Total cost in USD */
  total_cost: number;

  /** Average cost per request */
  avg_cost_per_request: number;

  /** Most used provider */
  primary_provider: ProviderName;
}

/**
 * Analytics query parameters
 *
 * @interface AnalyticsQuery
 */
export interface AnalyticsQuery {
  /** License ID to query */
  license_id: string;

  /** Period in YYYY-MM format (defaults to current month) */
  period?: string;

  /** Include task breakdown (requires audit_logs query) */
  include_task_breakdown?: boolean;
}

/**
 * Provider usage statistics
 *
 * @interface ProviderUsageStats
 */
export interface ProviderUsageStats {
  /** Provider name */
  provider: ProviderName;

  /** Total tokens consumed */
  total_tokens: number;

  /** Input tokens */
  tokens_input: number;

  /** Output tokens */
  tokens_output: number;

  /** Total cost in USD */
  total_cost: number;

  /** Percentage of total usage */
  usage_percentage: number;
}

/**
 * Monthly trend data point
 *
 * @interface MonthlyTrendPoint
 */
export interface MonthlyTrendPoint {
  /** Month in YYYY-MM format */
  month: string;

  /** Total tokens for the month */
  tokens: number;

  /** Total cost for the month */
  cost: number;

  /** Number of requests */
  requests: number;
}

/**
 * Extended analytics with trends
 *
 * @interface ExtendedAnalytics
 */
export interface ExtendedAnalytics extends AnalyticsResponse {
  /** Monthly trend data (last 6 months) */
  monthly_trend?: MonthlyTrendPoint[];

  /** Provider usage statistics */
  provider_stats?: ProviderUsageStats[];

  /** Comparison with previous period */
  comparison?: {
    /** Cost change percentage */
    cost_change_percent: number;

    /** Token change percentage */
    token_change_percent: number;

    /** Request change percentage */
    request_change_percent: number;
  };
}

/**
 * Creates an empty provider breakdown
 *
 * @returns {ProviderBreakdown} Empty provider breakdown
 */
export function createEmptyProviderBreakdown(): ProviderBreakdown {
  return {
    tokens: 0,
    tokens_input: 0,
    tokens_output: 0,
    cost: 0,
    requests: 0,
  };
}

/**
 * Creates an empty task breakdown
 *
 * @returns {TaskBreakdown} Empty task breakdown
 */
export function createEmptyTaskBreakdown(): TaskBreakdown {
  return {
    requests: 0,
    tokens: 0,
    cost: 0,
  };
}

/**
 * Creates an empty analytics response
 *
 * @param {string} licenseId - License ID
 * @param {string} period - Period in YYYY-MM format
 * @returns {AnalyticsResponse} Empty analytics response
 */
export function createEmptyAnalyticsResponse(
  licenseId: string,
  period: string
): AnalyticsResponse {
  return {
    period,
    license_id: licenseId,
    total_requests: 0,
    total_tokens: 0,
    total_cost: 0,
    breakdown_by_provider: {
      openai: createEmptyProviderBreakdown(),
      gemini: createEmptyProviderBreakdown(),
      claude: createEmptyProviderBreakdown(),
    },
    breakdown_by_task: {
      TEXT_GEN: createEmptyTaskBreakdown(),
      CODE_GEN: createEmptyTaskBreakdown(),
      DESIGN_GEN: createEmptyTaskBreakdown(),
      ECOMMERCE_GEN: createEmptyTaskBreakdown(),
    },
  };
}

/**
 * Gets the current period in YYYY-MM format
 *
 * @returns {string} Current period
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Validates a period string format
 *
 * @param {string} period - Period to validate
 * @returns {boolean} True if valid YYYY-MM format
 */
export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}
