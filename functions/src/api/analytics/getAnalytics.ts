/**
 * @fileoverview Analytics Endpoint for Creator AI Proxy
 * @module api/analytics/getAnalytics
 *
 * @description
 * GET /api/analytics
 *
 * Returns cost tracking and usage analytics for a license.
 * Provides dashboard-ready data including totals and breakdowns.
 *
 * Requires: Bearer token authentication (site_token)
 */

import { onRequest } from "firebase-functions/v2/https";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { jwtSecret } from "../../lib/secrets";
import { createRequestLogger } from "../../lib/logger";
import { authenticateRequest, sendAuthErrorResponse } from "../../middleware/auth";
import {
  getCostTracking,
  getRequestCountsByProvider,
  getTaskTypeBreakdown,
  getCostTrackingHistory,
} from "../../lib/firestore";
import {
  buildAnalyticsFromCostTracking,
  calculateProviderStats,
  calculatePeriodComparison,
} from "../../services/costCalculator";
import {
  ExtendedAnalytics,
  MonthlyTrendPoint,
  getCurrentPeriod,
  isValidPeriod,
} from "../../types/Analytics";
import { TaskType } from "../../types/Route";

/**
 * Extracts client IP from request
 */
function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Gets date range for a period
 *
 * @param {string} period - Period in YYYY-MM format
 * @returns {{ startDate: string; endDate: string }} ISO date strings
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

/**
 * Gets previous N months from a given period
 *
 * @param {string} period - Starting period in YYYY-MM format
 * @param {number} count - Number of months to get
 * @returns {string[]} Array of periods
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

/**
 * GET /api/analytics
 *
 * Returns analytics data for the authenticated license.
 *
 * @description
 * Query parameters:
 * - period: YYYY-MM format (default: current month)
 * - include_trend: boolean (default: false) - Include 6-month trend
 * - include_comparison: boolean (default: false) - Include previous period comparison
 *
 * Required headers:
 * - Authorization: Bearer {site_token}
 *
 * Success response (200):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "period": "2025-11",
 *     "license_id": "CREATOR-2024-XXXXX",
 *     "total_requests": 342,
 *     "total_tokens": 635000,
 *     "total_cost": 2.345,
 *     "breakdown_by_provider": {
 *       "openai": { "tokens": 234000, "cost": 1.245, "requests": 120 },
 *       "gemini": { "tokens": 390000, "cost": 0.758, "requests": 180 },
 *       "claude": { "tokens": 109000, "cost": 0.342, "requests": 42 }
 *     },
 *     "breakdown_by_task": {
 *       "TEXT_GEN": { "requests": 180, "tokens": 245000, "cost": 0.934 },
 *       "CODE_GEN": { "requests": 98, "tokens": 234000, "cost": 0.856 },
 *       "DESIGN_GEN": { "requests": 64, "tokens": 156000, "cost": 0.555 }
 *     }
 *   }
 * }
 * ```
 *
 * Error responses:
 * - 401: Missing or invalid Authorization header
 * - 400: Invalid period format
 * - 500: Internal server error
 */
export const getAnalytics = onRequest(
  {
    secrets: [jwtSecret],
    cors: true,
    maxInstances: 50,
  },
  async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const ipAddress = getClientIP(req);
    const logger = createRequestLogger(requestId, "/api/analytics", ipAddress);

    // Only allow GET
    if (req.method !== "GET") {
      logger.warn("Method not allowed", { method: req.method });
      res.status(405).json({
        success: false,
        error: "Method not allowed",
        code: "METHOD_NOT_ALLOWED",
      });
      return;
    }

    try {
      // 1. Authenticate request
      const authResult = await authenticateRequest(req, jwtSecret.value(), logger);

      if (!authResult.authenticated || !authResult.claims) {
        sendAuthErrorResponse(res, authResult);
        return;
      }

      const { claims } = authResult;
      const licenseId = claims.license_id;

      // 2. Parse query parameters
      const period = (req.query.period as string) || getCurrentPeriod();
      const includeTrend = req.query.include_trend === "true";
      const includeComparison = req.query.include_comparison === "true";

      // Validate period format
      if (!isValidPeriod(period)) {
        logger.warn("Invalid period format", { period });
        res.status(400).json({
          success: false,
          error: "Invalid period format. Use YYYY-MM (e.g., 2025-11)",
          code: "INVALID_PERIOD",
        });
        return;
      }

      logger.info("Fetching analytics", {
        license_id: licenseId,
        period,
        include_trend: includeTrend,
        include_comparison: includeComparison,
      });

      // 3. Get cost tracking data
      const costDoc = await getCostTracking(licenseId, period);

      // 4. Get request counts from audit logs
      const { startDate, endDate } = getPeriodDateRange(period);
      const requestCounts = await getRequestCountsByProvider(licenseId, startDate, endDate);

      // 5. Build base analytics response
      const analytics = buildAnalyticsFromCostTracking(
        costDoc,
        licenseId,
        period,
        requestCounts
      );

      // 6. Get task breakdown (requires additional query)
      const taskBreakdown = await getTaskTypeBreakdown(licenseId, startDate, endDate);
      analytics.breakdown_by_task = taskBreakdown as Record<TaskType, { requests: number; tokens: number; cost: number }>;

      // 7. Build extended analytics if requested
      const extendedAnalytics: ExtendedAnalytics = { ...analytics };

      // Add provider stats
      if (costDoc) {
        extendedAnalytics.provider_stats = calculateProviderStats(costDoc);
      }

      // Add monthly trend if requested
      if (includeTrend) {
        const trendMonths = getPreviousMonths(period, 6);
        const trendDocs = await getCostTrackingHistory(licenseId, trendMonths);

        const trendData: MonthlyTrendPoint[] = trendMonths.map((month) => {
          const doc = trendDocs.find((d) => d.month === month);
          if (doc) {
            return {
              month,
              tokens:
                doc.openai_tokens_input +
                doc.openai_tokens_output +
                doc.gemini_tokens_input +
                doc.gemini_tokens_output +
                doc.claude_tokens_input +
                doc.claude_tokens_output,
              cost: doc.total_cost_usd,
              requests: 0, // Would need to query audit_logs for each month
            };
          }
          return { month, tokens: 0, cost: 0, requests: 0 };
        });

        extendedAnalytics.monthly_trend = trendData.reverse(); // Oldest first
      }

      // Add period comparison if requested
      if (includeComparison) {
        const previousMonths = getPreviousMonths(period, 2);
        const previousPeriod = previousMonths[1]; // Second item is previous month

        const previousDoc = await getCostTracking(licenseId, previousPeriod);
        const { startDate: prevStart, endDate: prevEnd } = getPeriodDateRange(previousPeriod);
        const previousCounts = await getRequestCountsByProvider(licenseId, prevStart, prevEnd);

        const currentRequests =
          requestCounts.openai + requestCounts.gemini + requestCounts.claude;
        const prevRequests =
          previousCounts.openai + previousCounts.gemini + previousCounts.claude;

        if (previousDoc && costDoc) {
          extendedAnalytics.comparison = calculatePeriodComparison(
            costDoc,
            previousDoc,
            currentRequests,
            prevRequests
          );
        } else if (costDoc) {
          // No previous data, show 100% increase
          extendedAnalytics.comparison = {
            cost_change_percent: 100,
            token_change_percent: 100,
            request_change_percent: 100,
          };
        }
      }

      logger.info("Analytics retrieved successfully", {
        license_id: licenseId,
        period,
        total_cost: analytics.total_cost,
        total_requests: analytics.total_requests,
      });

      res.status(200).json({
        success: true,
        data: extendedAnalytics,
      });
    } catch (error) {
      logger.error("Unhandled error in analytics", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
    }
  }
);
