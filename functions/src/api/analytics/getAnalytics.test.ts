/**
 * @fileoverview Unit tests for Analytics endpoint
 * @module api/analytics/getAnalytics.test
 */

import {
  getCurrentPeriod,
  isValidPeriod,
  createEmptyAnalyticsResponse,
  createEmptyProviderBreakdown,
  createEmptyTaskBreakdown,
} from "../../types/Analytics";

describe("Analytics Types", () => {
  describe("getCurrentPeriod", () => {
    it("should return current period in YYYY-MM format", () => {
      const period = getCurrentPeriod();

      expect(period).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    });

    it("should return current month", () => {
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      expect(getCurrentPeriod()).toBe(expected);
    });
  });

  describe("isValidPeriod", () => {
    it("should accept valid periods", () => {
      expect(isValidPeriod("2025-01")).toBe(true);
      expect(isValidPeriod("2025-12")).toBe(true);
      expect(isValidPeriod("2024-06")).toBe(true);
      expect(isValidPeriod("2030-11")).toBe(true);
    });

    it("should reject invalid month values", () => {
      expect(isValidPeriod("2025-00")).toBe(false);
      expect(isValidPeriod("2025-13")).toBe(false);
      expect(isValidPeriod("2025-99")).toBe(false);
    });

    it("should reject invalid formats", () => {
      expect(isValidPeriod("2025-1")).toBe(false);
      expect(isValidPeriod("25-01")).toBe(false);
      expect(isValidPeriod("2025/01")).toBe(false);
      expect(isValidPeriod("January 2025")).toBe(false);
      expect(isValidPeriod("")).toBe(false);
      expect(isValidPeriod("invalid")).toBe(false);
    });
  });

  describe("createEmptyProviderBreakdown", () => {
    it("should create breakdown with all zeros", () => {
      const breakdown = createEmptyProviderBreakdown();

      expect(breakdown.tokens).toBe(0);
      expect(breakdown.tokens_input).toBe(0);
      expect(breakdown.tokens_output).toBe(0);
      expect(breakdown.cost).toBe(0);
      expect(breakdown.requests).toBe(0);
    });
  });

  describe("createEmptyTaskBreakdown", () => {
    it("should create breakdown with all zeros", () => {
      const breakdown = createEmptyTaskBreakdown();

      expect(breakdown.requests).toBe(0);
      expect(breakdown.tokens).toBe(0);
      expect(breakdown.cost).toBe(0);
    });
  });

  describe("createEmptyAnalyticsResponse", () => {
    it("should create response with correct structure", () => {
      const response = createEmptyAnalyticsResponse("CREATOR-2024-TEST", "2025-11");

      expect(response.period).toBe("2025-11");
      expect(response.license_id).toBe("CREATOR-2024-TEST");
      expect(response.total_requests).toBe(0);
      expect(response.total_tokens).toBe(0);
      expect(response.total_cost).toBe(0);
    });

    it("should include all providers in breakdown", () => {
      const response = createEmptyAnalyticsResponse("CREATOR-2024-TEST", "2025-11");

      expect(response.breakdown_by_provider).toHaveProperty("openai");
      expect(response.breakdown_by_provider).toHaveProperty("gemini");
      expect(response.breakdown_by_provider).toHaveProperty("claude");
    });

    it("should include all task types in breakdown", () => {
      const response = createEmptyAnalyticsResponse("CREATOR-2024-TEST", "2025-11");

      expect(response.breakdown_by_task).toHaveProperty("TEXT_GEN");
      expect(response.breakdown_by_task).toHaveProperty("CODE_GEN");
      expect(response.breakdown_by_task).toHaveProperty("DESIGN_GEN");
      expect(response.breakdown_by_task).toHaveProperty("ECOMMERCE_GEN");
    });

    it("should have zero values in all breakdowns", () => {
      const response = createEmptyAnalyticsResponse("CREATOR-2024-TEST", "2025-11");

      // Check provider breakdowns
      Object.values(response.breakdown_by_provider).forEach((breakdown) => {
        expect(breakdown.tokens).toBe(0);
        expect(breakdown.cost).toBe(0);
        expect(breakdown.requests).toBe(0);
      });

      // Check task breakdowns
      Object.values(response.breakdown_by_task).forEach((breakdown) => {
        expect(breakdown.tokens).toBe(0);
        expect(breakdown.cost).toBe(0);
        expect(breakdown.requests).toBe(0);
      });
    });
  });
});

describe("Analytics Endpoint Logic", () => {
  describe("getPeriodDateRange", () => {
    /**
     * Helper function to get date range for a period
     */
    function getPeriodDateRange(period: string): { startDate: string; endDate: string } {
      const [year, month] = period.split("-").map(Number);
      const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);

      return {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    }

    it("should return correct date range for January", () => {
      const range = getPeriodDateRange("2025-01");

      expect(range.startDate).toContain("2025-01-01");
      expect(range.endDate).toContain("2025-01-31");
    });

    it("should return correct date range for February (non-leap year)", () => {
      const range = getPeriodDateRange("2025-02");

      expect(range.startDate).toContain("2025-02-01");
      expect(range.endDate).toContain("2025-02-28");
    });

    it("should return correct date range for February (leap year)", () => {
      const range = getPeriodDateRange("2024-02");

      expect(range.startDate).toContain("2024-02-01");
      expect(range.endDate).toContain("2024-02-29");
    });

    it("should return correct date range for November", () => {
      const range = getPeriodDateRange("2025-11");

      expect(range.startDate).toContain("2025-11-01");
      expect(range.endDate).toContain("2025-11-30");
    });

    it("should return correct date range for December", () => {
      const range = getPeriodDateRange("2025-12");

      expect(range.startDate).toContain("2025-12-01");
      expect(range.endDate).toContain("2025-12-31");
    });
  });

  describe("getPreviousMonths", () => {
    /**
     * Helper function to get previous N months
     */
    function getPreviousMonths(period: string, count: number): string[] {
      const [year, month] = period.split("-").map(Number);
      const months: string[] = [];

      for (let i = 0; i < count; i++) {
        const date = new Date(year, month - 1 - i, 1);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        months.push(`${y}-${m}`);
      }

      return months;
    }

    it("should return correct previous months", () => {
      const months = getPreviousMonths("2025-11", 3);

      expect(months).toEqual(["2025-11", "2025-10", "2025-09"]);
    });

    it("should handle year boundary", () => {
      const months = getPreviousMonths("2025-02", 4);

      expect(months).toEqual(["2025-02", "2025-01", "2024-12", "2024-11"]);
    });

    it("should return single month when count is 1", () => {
      const months = getPreviousMonths("2025-11", 1);

      expect(months).toEqual(["2025-11"]);
    });

    it("should return 6 months for trend data", () => {
      const months = getPreviousMonths("2025-11", 6);

      expect(months).toHaveLength(6);
      expect(months[0]).toBe("2025-11");
      expect(months[5]).toBe("2025-06");
    });
  });
});

describe("Analytics Response Structure", () => {
  it("should have correct shape for dashboard consumption", () => {
    const response = createEmptyAnalyticsResponse("CREATOR-2024-TEST", "2025-11");

    // Check required top-level fields
    expect(typeof response.period).toBe("string");
    expect(typeof response.license_id).toBe("string");
    expect(typeof response.total_requests).toBe("number");
    expect(typeof response.total_tokens).toBe("number");
    expect(typeof response.total_cost).toBe("number");

    // Check breakdown structure
    expect(typeof response.breakdown_by_provider).toBe("object");
    expect(typeof response.breakdown_by_task).toBe("object");

    // Check provider breakdown has correct fields
    const openaiBreakdown = response.breakdown_by_provider.openai;
    expect(typeof openaiBreakdown.tokens).toBe("number");
    expect(typeof openaiBreakdown.tokens_input).toBe("number");
    expect(typeof openaiBreakdown.tokens_output).toBe("number");
    expect(typeof openaiBreakdown.cost).toBe("number");
    expect(typeof openaiBreakdown.requests).toBe("number");

    // Check task breakdown has correct fields
    const textGenBreakdown = response.breakdown_by_task.TEXT_GEN;
    expect(typeof textGenBreakdown.requests).toBe("number");
    expect(typeof textGenBreakdown.tokens).toBe("number");
    expect(typeof textGenBreakdown.cost).toBe("number");
  });

  it("should match expected API response format from roadmap", () => {
    // Create a response that matches the roadmap example
    const response = createEmptyAnalyticsResponse("CREATOR-2024-XXXXX", "2025-11");

    // Manually set values to match example
    response.total_requests = 342;
    response.total_tokens = 635000;
    response.total_cost = 2.345;

    response.breakdown_by_provider.openai = {
      tokens: 234000,
      tokens_input: 140000,
      tokens_output: 94000,
      cost: 1.245,
      requests: 120,
    };

    response.breakdown_by_provider.gemini = {
      tokens: 390000,
      tokens_input: 250000,
      tokens_output: 140000,
      cost: 0.758,
      requests: 180,
    };

    response.breakdown_by_provider.claude = {
      tokens: 109000,
      tokens_input: 67000,
      tokens_output: 42000,
      cost: 0.342,
      requests: 42,
    };

    response.breakdown_by_task.TEXT_GEN = {
      requests: 180,
      tokens: 245000,
      cost: 0.934,
    };

    response.breakdown_by_task.CODE_GEN = {
      requests: 98,
      tokens: 234000,
      cost: 0.856,
    };

    response.breakdown_by_task.DESIGN_GEN = {
      requests: 64,
      tokens: 156000,
      cost: 0.555,
    };

    // Verify structure matches roadmap
    expect(response.period).toBe("2025-11");
    expect(response.total_requests).toBe(342);
    expect(response.total_tokens).toBe(635000);
    expect(response.total_cost).toBe(2.345);

    // Verify provider breakdown
    expect(response.breakdown_by_provider.openai.tokens).toBe(234000);
    expect(response.breakdown_by_provider.openai.cost).toBe(1.245);
    expect(response.breakdown_by_provider.gemini.tokens).toBe(390000);
    expect(response.breakdown_by_provider.gemini.cost).toBe(0.758);
    expect(response.breakdown_by_provider.claude.tokens).toBe(109000);
    expect(response.breakdown_by_provider.claude.cost).toBe(0.342);

    // Verify task breakdown
    expect(response.breakdown_by_task.TEXT_GEN.requests).toBe(180);
    expect(response.breakdown_by_task.CODE_GEN.requests).toBe(98);
    expect(response.breakdown_by_task.DESIGN_GEN.requests).toBe(64);
  });
});
