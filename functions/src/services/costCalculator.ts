/**
 * @fileoverview Cost Calculator Service for Creator AI Proxy
 * @module services/costCalculator
 *
 * @description
 * Centralizes all cost calculation logic including:
 * - Per-request cost calculation
 * - Analytics aggregation
 * - Cost projections and summaries
 */

import {
  ProviderName,
  PROVIDER_PRICING,
  ProviderPricing,
} from "../types/AIProvider";
import {
  CostTrackingDocument,
  AnalyticsResponse,
  ProviderBreakdown,
  CostSummary,
  ProviderUsageStats,
  createEmptyAnalyticsResponse,
} from "../types/Analytics";

/**
 * Cost calculation result
 *
 * @interface CostCalculationResult
 */
export interface CostCalculationResult {
  /** Total cost in USD */
  total_cost: number;

  /** Input cost component */
  input_cost: number;

  /** Output cost component */
  output_cost: number;

  /** Pricing used for calculation */
  pricing: ProviderPricing;
}

/**
 * Default pricing for unknown models
 * Uses conservative (higher) estimates
 */
const DEFAULT_PRICING: ProviderPricing = {
  input_cost_per_1k: 0.01,
  output_cost_per_1k: 0.03,
};

/**
 * Gets pricing for a provider/model combination
 *
 * @param {ProviderName} provider - Provider name
 * @param {string} model - Model name
 * @returns {ProviderPricing} Pricing configuration
 *
 * @example
 * ```typescript
 * const pricing = getPricing("openai", "gpt-4o");
 * console.log(pricing.input_cost_per_1k); // 0.005
 * ```
 */
export function getPricing(
  provider: ProviderName,
  model: string
): ProviderPricing {
  const providerPricing = PROVIDER_PRICING[provider];

  if (!providerPricing) {
    return DEFAULT_PRICING;
  }

  return providerPricing[model] || DEFAULT_PRICING;
}

/**
 * Calculates the cost for a single request
 *
 * @param {ProviderName} provider - Provider name
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {CostCalculationResult} Detailed cost breakdown
 *
 * @description
 * Uses provider-specific pricing when available, falls back to
 * conservative estimates for unknown models.
 *
 * @example
 * ```typescript
 * const result = calculateRequestCost("openai", "gpt-4o", 1000, 500);
 * console.log(result.total_cost); // 0.0125 USD
 * ```
 */
export function calculateRequestCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number
): CostCalculationResult {
  const pricing = getPricing(provider, model);

  const inputCost = (inputTokens * pricing.input_cost_per_1k) / 1000;
  const outputCost = (outputTokens * pricing.output_cost_per_1k) / 1000;

  return {
    total_cost: inputCost + outputCost,
    input_cost: inputCost,
    output_cost: outputCost,
    pricing,
  };
}

/**
 * Calculates cost from a cost tracking document
 *
 * @param {CostTrackingDocument} doc - Cost tracking document
 * @returns {number} Total cost in USD
 */
export function calculateTotalCostFromDocument(
  doc: CostTrackingDocument
): number {
  return (
    doc.openai_cost_usd +
    doc.gemini_cost_usd +
    doc.claude_cost_usd
  );
}

/**
 * Builds provider breakdown from cost tracking document
 *
 * @param {CostTrackingDocument} doc - Cost tracking document
 * @param {Record<ProviderName, number>} requestCounts - Request counts per provider
 * @returns {Record<ProviderName, ProviderBreakdown>} Provider breakdowns
 *
 * @example
 * ```typescript
 * const breakdown = buildProviderBreakdown(costDoc, { openai: 50, gemini: 100, claude: 20 });
 * console.log(breakdown.gemini.tokens); // Total gemini tokens
 * ```
 */
export function buildProviderBreakdown(
  doc: CostTrackingDocument,
  requestCounts: Record<ProviderName, number>
): Record<ProviderName, ProviderBreakdown> {
  return {
    openai: {
      tokens: doc.openai_tokens_input + doc.openai_tokens_output,
      tokens_input: doc.openai_tokens_input,
      tokens_output: doc.openai_tokens_output,
      cost: doc.openai_cost_usd,
      requests: requestCounts.openai,
    },
    gemini: {
      tokens: doc.gemini_tokens_input + doc.gemini_tokens_output,
      tokens_input: doc.gemini_tokens_input,
      tokens_output: doc.gemini_tokens_output,
      cost: doc.gemini_cost_usd,
      requests: requestCounts.gemini,
    },
    claude: {
      tokens: doc.claude_tokens_input + doc.claude_tokens_output,
      tokens_input: doc.claude_tokens_input,
      tokens_output: doc.claude_tokens_output,
      cost: doc.claude_cost_usd,
      requests: requestCounts.claude,
    },
  };
}

/**
 * Builds analytics response from cost tracking document
 *
 * @param {CostTrackingDocument | null} doc - Cost tracking document (null if not found)
 * @param {string} licenseId - License ID
 * @param {string} period - Period in YYYY-MM format
 * @param {Record<ProviderName, number>} requestCounts - Request counts per provider
 * @returns {AnalyticsResponse} Analytics response
 *
 * @example
 * ```typescript
 * const analytics = buildAnalyticsFromCostTracking(
 *   costDoc,
 *   "CREATOR-2024-XXXXX",
 *   "2025-11",
 *   { openai: 50, gemini: 100, claude: 20 }
 * );
 * ```
 */
export function buildAnalyticsFromCostTracking(
  doc: CostTrackingDocument | null,
  licenseId: string,
  period: string,
  requestCounts: Record<ProviderName, number>
): AnalyticsResponse {
  if (!doc) {
    return createEmptyAnalyticsResponse(licenseId, period);
  }

  const totalTokens =
    doc.openai_tokens_input +
    doc.openai_tokens_output +
    doc.gemini_tokens_input +
    doc.gemini_tokens_output +
    doc.claude_tokens_input +
    doc.claude_tokens_output;

  const totalRequests =
    requestCounts.openai + requestCounts.gemini + requestCounts.claude;

  const response = createEmptyAnalyticsResponse(licenseId, period);

  response.total_tokens = totalTokens;
  response.total_cost = doc.total_cost_usd;
  response.total_requests = totalRequests;
  response.breakdown_by_provider = buildProviderBreakdown(doc, requestCounts);

  return response;
}

/**
 * Calculates cost summary for a license
 *
 * @param {CostTrackingDocument} doc - Cost tracking document
 * @param {number} totalRequests - Total number of requests
 * @returns {CostSummary} Cost summary
 */
export function calculateCostSummary(
  doc: CostTrackingDocument,
  totalRequests: number
): CostSummary {
  const totalTokens =
    doc.openai_tokens_input +
    doc.openai_tokens_output +
    doc.gemini_tokens_input +
    doc.gemini_tokens_output +
    doc.claude_tokens_input +
    doc.claude_tokens_output;

  // Determine primary provider by cost
  const providerCosts: { provider: ProviderName; cost: number }[] = [
    { provider: "openai", cost: doc.openai_cost_usd },
    { provider: "gemini", cost: doc.gemini_cost_usd },
    { provider: "claude", cost: doc.claude_cost_usd },
  ];

  providerCosts.sort((a, b) => b.cost - a.cost);
  const primaryProvider = providerCosts[0].provider;

  return {
    license_id: doc.license_id,
    period: doc.month,
    total_tokens: totalTokens,
    total_cost: doc.total_cost_usd,
    avg_cost_per_request: totalRequests > 0 ? doc.total_cost_usd / totalRequests : 0,
    primary_provider: primaryProvider,
  };
}

/**
 * Calculates provider usage statistics
 *
 * @param {CostTrackingDocument} doc - Cost tracking document
 * @returns {ProviderUsageStats[]} Array of provider statistics
 *
 * @description
 * Returns statistics sorted by usage percentage (highest first).
 */
export function calculateProviderStats(
  doc: CostTrackingDocument
): ProviderUsageStats[] {
  const totalTokens =
    doc.openai_tokens_input +
    doc.openai_tokens_output +
    doc.gemini_tokens_input +
    doc.gemini_tokens_output +
    doc.claude_tokens_input +
    doc.claude_tokens_output;

  const stats: ProviderUsageStats[] = [
    {
      provider: "openai",
      total_tokens: doc.openai_tokens_input + doc.openai_tokens_output,
      tokens_input: doc.openai_tokens_input,
      tokens_output: doc.openai_tokens_output,
      total_cost: doc.openai_cost_usd,
      usage_percentage:
        totalTokens > 0
          ? ((doc.openai_tokens_input + doc.openai_tokens_output) / totalTokens) * 100
          : 0,
    },
    {
      provider: "gemini",
      total_tokens: doc.gemini_tokens_input + doc.gemini_tokens_output,
      tokens_input: doc.gemini_tokens_input,
      tokens_output: doc.gemini_tokens_output,
      total_cost: doc.gemini_cost_usd,
      usage_percentage:
        totalTokens > 0
          ? ((doc.gemini_tokens_input + doc.gemini_tokens_output) / totalTokens) * 100
          : 0,
    },
    {
      provider: "claude",
      total_tokens: doc.claude_tokens_input + doc.claude_tokens_output,
      tokens_input: doc.claude_tokens_input,
      tokens_output: doc.claude_tokens_output,
      total_cost: doc.claude_cost_usd,
      usage_percentage:
        totalTokens > 0
          ? ((doc.claude_tokens_input + doc.claude_tokens_output) / totalTokens) * 100
          : 0,
    },
  ];

  // Sort by usage percentage descending
  return stats.sort((a, b) => b.usage_percentage - a.usage_percentage);
}

/**
 * Estimates monthly cost based on current usage
 *
 * @param {CostTrackingDocument} doc - Cost tracking document
 * @param {number} dayOfMonth - Current day of the month (1-31)
 * @returns {number} Estimated monthly cost in USD
 *
 * @description
 * Projects the current month's cost based on daily average.
 *
 * @example
 * ```typescript
 * // On day 15 with $10 spent so far
 * const estimated = estimateMonthlyCost(doc, 15);
 * // Returns approximately $20 (assuming 30-day month)
 * ```
 */
export function estimateMonthlyCost(
  doc: CostTrackingDocument,
  dayOfMonth: number
): number {
  if (dayOfMonth <= 0) {
    return 0;
  }

  // Get days in current month
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const dailyAverage = doc.total_cost_usd / dayOfMonth;
  return dailyAverage * daysInMonth;
}

/**
 * Calculates period comparison (current vs previous)
 *
 * @param {CostTrackingDocument} current - Current period document
 * @param {CostTrackingDocument} previous - Previous period document
 * @param {number} currentRequests - Current period request count
 * @param {number} previousRequests - Previous period request count
 * @returns {{ cost_change_percent: number; token_change_percent: number; request_change_percent: number }}
 */
export function calculatePeriodComparison(
  current: CostTrackingDocument,
  previous: CostTrackingDocument,
  currentRequests: number,
  previousRequests: number
): {
  cost_change_percent: number;
  token_change_percent: number;
  request_change_percent: number;
} {
  const currentTokens =
    current.openai_tokens_input +
    current.openai_tokens_output +
    current.gemini_tokens_input +
    current.gemini_tokens_output +
    current.claude_tokens_input +
    current.claude_tokens_output;

  const previousTokens =
    previous.openai_tokens_input +
    previous.openai_tokens_output +
    previous.gemini_tokens_input +
    previous.gemini_tokens_output +
    previous.claude_tokens_input +
    previous.claude_tokens_output;

  const calculateChange = (curr: number, prev: number): number => {
    if (prev === 0) {
      return curr > 0 ? 100 : 0;
    }
    return ((curr - prev) / prev) * 100;
  };

  return {
    cost_change_percent: calculateChange(current.total_cost_usd, previous.total_cost_usd),
    token_change_percent: calculateChange(currentTokens, previousTokens),
    request_change_percent: calculateChange(currentRequests, previousRequests),
  };
}

/**
 * Formats cost for display
 *
 * @param {number} cost - Cost in USD
 * @param {number} decimals - Number of decimal places (default: 4)
 * @returns {string} Formatted cost string
 *
 * @example
 * ```typescript
 * formatCost(0.00125); // "$0.0013"
 * formatCost(1.5);     // "$1.5000"
 * ```
 */
export function formatCost(cost: number, decimals: number = 4): string {
  return `$${cost.toFixed(decimals)}`;
}

/**
 * Formats token count for display
 *
 * @param {number} tokens - Token count
 * @returns {string} Formatted token string
 *
 * @example
 * ```typescript
 * formatTokens(1500);    // "1,500"
 * formatTokens(1500000); // "1,500,000"
 * ```
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

/**
 * Creates an empty cost tracking document
 *
 * @param {string} licenseId - License ID
 * @param {string} month - Month in YYYY-MM format
 * @returns {CostTrackingDocument} Empty cost tracking document
 */
export function createEmptyCostTrackingDocument(
  licenseId: string,
  month: string
): CostTrackingDocument {
  return {
    license_id: licenseId,
    month,
    openai_tokens_input: 0,
    openai_tokens_output: 0,
    openai_cost_usd: 0,
    gemini_tokens_input: 0,
    gemini_tokens_output: 0,
    gemini_cost_usd: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    claude_cost_usd: 0,
    total_cost_usd: 0,
  };
}
