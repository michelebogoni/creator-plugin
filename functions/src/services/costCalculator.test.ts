/**
 * @fileoverview Unit tests for Cost Calculator service
 * @module services/costCalculator.test
 */

import {
  getPricing,
  calculateRequestCost,
  calculateTotalCostFromDocument,
  buildProviderBreakdown,
  buildAnalyticsFromCostTracking,
  calculateCostSummary,
  calculateProviderStats,
  estimateMonthlyCost,
  calculatePeriodComparison,
  formatCost,
  formatTokens,
  createEmptyCostTrackingDocument,
} from "./costCalculator";
import { CostTrackingDocument } from "../types/Analytics";

/**
 * Creates a mock cost tracking document for testing
 */
function createMockCostTrackingDocument(
  overrides: Partial<CostTrackingDocument> = {}
): CostTrackingDocument {
  return {
    license_id: "CREATOR-2024-TEST",
    month: "2025-11",
    openai_tokens_input: 10000,
    openai_tokens_output: 5000,
    openai_cost_usd: 0.125,
    gemini_tokens_input: 50000,
    gemini_tokens_output: 25000,
    gemini_cost_usd: 0.011,
    claude_tokens_input: 8000,
    claude_tokens_output: 4000,
    claude_cost_usd: 0.084,
    total_cost_usd: 0.22,
    ...overrides,
  };
}

describe("costCalculator", () => {
  describe("getPricing", () => {
    it("should return correct pricing for OpenAI gpt-4o", () => {
      const pricing = getPricing("openai", "gpt-4o");

      expect(pricing.input_cost_per_1k).toBe(0.005);
      expect(pricing.output_cost_per_1k).toBe(0.015);
    });

    it("should return correct pricing for OpenAI gpt-4o-mini", () => {
      const pricing = getPricing("openai", "gpt-4o-mini");

      expect(pricing.input_cost_per_1k).toBe(0.00015);
      expect(pricing.output_cost_per_1k).toBe(0.0006);
    });

    it("should return correct pricing for Gemini flash", () => {
      const pricing = getPricing("gemini", "gemini-1.5-flash");

      expect(pricing.input_cost_per_1k).toBe(0.000075);
      expect(pricing.output_cost_per_1k).toBe(0.0003);
    });

    it("should return correct pricing for Gemini pro", () => {
      const pricing = getPricing("gemini", "gemini-1.5-pro");

      expect(pricing.input_cost_per_1k).toBe(0.00125);
      expect(pricing.output_cost_per_1k).toBe(0.005);
    });

    it("should return correct pricing for Claude", () => {
      const pricing = getPricing("claude", "claude-3-5-sonnet-20241022");

      expect(pricing.input_cost_per_1k).toBe(0.003);
      expect(pricing.output_cost_per_1k).toBe(0.015);
    });

    it("should return default pricing for unknown model", () => {
      const pricing = getPricing("openai", "unknown-model");

      expect(pricing.input_cost_per_1k).toBe(0.01);
      expect(pricing.output_cost_per_1k).toBe(0.03);
    });
  });

  describe("calculateRequestCost", () => {
    it("should calculate cost for OpenAI gpt-4o correctly", () => {
      const result = calculateRequestCost("openai", "gpt-4o", 1000, 500);

      // Input: 1000 * 0.005 / 1000 = 0.005
      // Output: 500 * 0.015 / 1000 = 0.0075
      // Total: 0.0125
      expect(result.total_cost).toBeCloseTo(0.0125, 5);
      expect(result.input_cost).toBeCloseTo(0.005, 5);
      expect(result.output_cost).toBeCloseTo(0.0075, 5);
    });

    it("should calculate cost for Gemini flash correctly", () => {
      const result = calculateRequestCost("gemini", "gemini-1.5-flash", 100000, 50000);

      // Input: 100000 * 0.000075 / 1000 = 0.0075
      // Output: 50000 * 0.0003 / 1000 = 0.015
      // Total: 0.0225
      expect(result.total_cost).toBeCloseTo(0.0225, 5);
    });

    it("should calculate cost for Claude correctly", () => {
      const result = calculateRequestCost("claude", "claude-3-5-sonnet-20241022", 2000, 1000);

      // Input: 2000 * 0.003 / 1000 = 0.006
      // Output: 1000 * 0.015 / 1000 = 0.015
      // Total: 0.021
      expect(result.total_cost).toBeCloseTo(0.021, 5);
    });

    it("should return zero cost for zero tokens", () => {
      const result = calculateRequestCost("openai", "gpt-4o", 0, 0);

      expect(result.total_cost).toBe(0);
      expect(result.input_cost).toBe(0);
      expect(result.output_cost).toBe(0);
    });

    it("should use default pricing for unknown model", () => {
      const result = calculateRequestCost("openai", "unknown-model", 1000, 1000);

      // Default: input 0.01, output 0.03
      // Input: 1000 * 0.01 / 1000 = 0.01
      // Output: 1000 * 0.03 / 1000 = 0.03
      // Total: 0.04
      expect(result.total_cost).toBeCloseTo(0.04, 5);
    });
  });

  describe("calculateTotalCostFromDocument", () => {
    it("should sum all provider costs", () => {
      const doc = createMockCostTrackingDocument({
        openai_cost_usd: 1.0,
        gemini_cost_usd: 0.5,
        claude_cost_usd: 0.3,
      });

      const total = calculateTotalCostFromDocument(doc);

      expect(total).toBeCloseTo(1.8, 5);
    });

    it("should return zero for empty document", () => {
      const doc = createMockCostTrackingDocument({
        openai_cost_usd: 0,
        gemini_cost_usd: 0,
        claude_cost_usd: 0,
      });

      const total = calculateTotalCostFromDocument(doc);

      expect(total).toBe(0);
    });
  });

  describe("buildProviderBreakdown", () => {
    it("should build correct breakdown from document", () => {
      const doc = createMockCostTrackingDocument();
      const requestCounts = { openai: 50, gemini: 100, claude: 30 };

      const breakdown = buildProviderBreakdown(doc, requestCounts);

      expect(breakdown.openai.tokens).toBe(15000); // 10000 + 5000
      expect(breakdown.openai.tokens_input).toBe(10000);
      expect(breakdown.openai.tokens_output).toBe(5000);
      expect(breakdown.openai.cost).toBe(0.125);
      expect(breakdown.openai.requests).toBe(50);

      expect(breakdown.gemini.tokens).toBe(75000); // 50000 + 25000
      expect(breakdown.gemini.requests).toBe(100);

      expect(breakdown.claude.tokens).toBe(12000); // 8000 + 4000
      expect(breakdown.claude.requests).toBe(30);
    });
  });

  describe("buildAnalyticsFromCostTracking", () => {
    it("should build complete analytics response", () => {
      const doc = createMockCostTrackingDocument();
      const requestCounts = { openai: 50, gemini: 100, claude: 30 };

      const analytics = buildAnalyticsFromCostTracking(
        doc,
        "CREATOR-2024-TEST",
        "2025-11",
        requestCounts
      );

      expect(analytics.period).toBe("2025-11");
      expect(analytics.license_id).toBe("CREATOR-2024-TEST");
      expect(analytics.total_tokens).toBe(102000); // All input + output tokens
      expect(analytics.total_cost).toBe(0.22);
      expect(analytics.total_requests).toBe(180); // 50 + 100 + 30
    });

    it("should return empty analytics when document is null", () => {
      const requestCounts = { openai: 0, gemini: 0, claude: 0 };

      const analytics = buildAnalyticsFromCostTracking(
        null,
        "CREATOR-2024-TEST",
        "2025-11",
        requestCounts
      );

      expect(analytics.total_tokens).toBe(0);
      expect(analytics.total_cost).toBe(0);
      expect(analytics.total_requests).toBe(0);
    });
  });

  describe("calculateCostSummary", () => {
    it("should calculate summary correctly", () => {
      const doc = createMockCostTrackingDocument({
        openai_cost_usd: 1.0,
        gemini_cost_usd: 0.5,
        claude_cost_usd: 0.3,
        total_cost_usd: 1.8,
      });

      const summary = calculateCostSummary(doc, 180);

      expect(summary.license_id).toBe("CREATOR-2024-TEST");
      expect(summary.period).toBe("2025-11");
      expect(summary.total_cost).toBe(1.8);
      expect(summary.avg_cost_per_request).toBeCloseTo(0.01, 5);
      expect(summary.primary_provider).toBe("openai"); // Highest cost
    });

    it("should handle zero requests", () => {
      const doc = createMockCostTrackingDocument();

      const summary = calculateCostSummary(doc, 0);

      expect(summary.avg_cost_per_request).toBe(0);
    });

    it("should identify correct primary provider", () => {
      const doc = createMockCostTrackingDocument({
        openai_cost_usd: 0.1,
        gemini_cost_usd: 2.0,
        claude_cost_usd: 0.5,
      });

      const summary = calculateCostSummary(doc, 100);

      expect(summary.primary_provider).toBe("gemini");
    });
  });

  describe("calculateProviderStats", () => {
    it("should calculate usage percentages correctly", () => {
      const doc = createMockCostTrackingDocument({
        openai_tokens_input: 5000,
        openai_tokens_output: 5000,
        gemini_tokens_input: 40000,
        gemini_tokens_output: 40000,
        claude_tokens_input: 5000,
        claude_tokens_output: 5000,
      });

      const stats = calculateProviderStats(doc);

      // Total: 10000 + 80000 + 10000 = 100000
      // Gemini should be first (highest usage)
      expect(stats[0].provider).toBe("gemini");
      expect(stats[0].usage_percentage).toBeCloseTo(80, 1);

      // OpenAI and Claude should have 10% each
      expect(stats[1].usage_percentage).toBeCloseTo(10, 1);
      expect(stats[2].usage_percentage).toBeCloseTo(10, 1);
    });

    it("should handle zero total tokens", () => {
      const doc = createMockCostTrackingDocument({
        openai_tokens_input: 0,
        openai_tokens_output: 0,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const stats = calculateProviderStats(doc);

      stats.forEach((stat) => {
        expect(stat.usage_percentage).toBe(0);
      });
    });
  });

  describe("estimateMonthlyCost", () => {
    it("should estimate monthly cost based on daily average", () => {
      const doc = createMockCostTrackingDocument({
        total_cost_usd: 15.0, // $15 over 15 days = $1/day
      });

      // Mock: day 15 of a 30-day month
      const estimated = estimateMonthlyCost(doc, 15);

      // Should project to ~$30 for full month
      expect(estimated).toBeGreaterThan(25);
      expect(estimated).toBeLessThan(35);
    });

    it("should return zero for day 0", () => {
      const doc = createMockCostTrackingDocument({
        total_cost_usd: 15.0,
      });

      const estimated = estimateMonthlyCost(doc, 0);

      expect(estimated).toBe(0);
    });

    it("should return zero for negative day", () => {
      const doc = createMockCostTrackingDocument({
        total_cost_usd: 15.0,
      });

      const estimated = estimateMonthlyCost(doc, -1);

      expect(estimated).toBe(0);
    });
  });

  describe("calculatePeriodComparison", () => {
    it("should calculate positive change correctly", () => {
      const current = createMockCostTrackingDocument({
        total_cost_usd: 200,
        openai_tokens_input: 20000,
        openai_tokens_output: 10000,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const previous = createMockCostTrackingDocument({
        total_cost_usd: 100,
        openai_tokens_input: 10000,
        openai_tokens_output: 5000,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const comparison = calculatePeriodComparison(current, previous, 200, 100);

      expect(comparison.cost_change_percent).toBeCloseTo(100, 1); // Doubled
      expect(comparison.token_change_percent).toBeCloseTo(100, 1);
      expect(comparison.request_change_percent).toBeCloseTo(100, 1);
    });

    it("should calculate negative change correctly", () => {
      const current = createMockCostTrackingDocument({
        total_cost_usd: 50,
        openai_tokens_input: 5000,
        openai_tokens_output: 2500,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const previous = createMockCostTrackingDocument({
        total_cost_usd: 100,
        openai_tokens_input: 10000,
        openai_tokens_output: 5000,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const comparison = calculatePeriodComparison(current, previous, 50, 100);

      expect(comparison.cost_change_percent).toBeCloseTo(-50, 1); // Halved
      expect(comparison.token_change_percent).toBeCloseTo(-50, 1);
      expect(comparison.request_change_percent).toBeCloseTo(-50, 1);
    });

    it("should handle zero previous values", () => {
      const current = createMockCostTrackingDocument({
        total_cost_usd: 100,
      });

      const previous = createMockCostTrackingDocument({
        total_cost_usd: 0,
        openai_tokens_input: 0,
        openai_tokens_output: 0,
        gemini_tokens_input: 0,
        gemini_tokens_output: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
      });

      const comparison = calculatePeriodComparison(current, previous, 100, 0);

      expect(comparison.cost_change_percent).toBe(100); // New usage
      expect(comparison.request_change_percent).toBe(100);
    });
  });

  describe("formatCost", () => {
    it("should format cost with default decimals", () => {
      expect(formatCost(0.00125)).toBe("$0.0013");
      expect(formatCost(1.5)).toBe("$1.5000");
      expect(formatCost(0)).toBe("$0.0000");
    });

    it("should format cost with custom decimals", () => {
      expect(formatCost(1.5, 2)).toBe("$1.50");
      expect(formatCost(0.123456, 6)).toBe("$0.123456");
    });
  });

  describe("formatTokens", () => {
    it("should format tokens with commas", () => {
      expect(formatTokens(1500)).toBe("1,500");
      expect(formatTokens(1500000)).toBe("1,500,000");
      expect(formatTokens(100)).toBe("100");
      expect(formatTokens(0)).toBe("0");
    });
  });

  describe("createEmptyCostTrackingDocument", () => {
    it("should create document with correct structure", () => {
      const doc = createEmptyCostTrackingDocument("CREATOR-2024-TEST", "2025-11");

      expect(doc.license_id).toBe("CREATOR-2024-TEST");
      expect(doc.month).toBe("2025-11");
      expect(doc.openai_tokens_input).toBe(0);
      expect(doc.openai_tokens_output).toBe(0);
      expect(doc.openai_cost_usd).toBe(0);
      expect(doc.gemini_tokens_input).toBe(0);
      expect(doc.gemini_tokens_output).toBe(0);
      expect(doc.gemini_cost_usd).toBe(0);
      expect(doc.claude_tokens_input).toBe(0);
      expect(doc.claude_tokens_output).toBe(0);
      expect(doc.claude_cost_usd).toBe(0);
      expect(doc.total_cost_usd).toBe(0);
    });
  });
});
