/**
 * @fileoverview Submit Task Endpoint for Creator AI Proxy
 * @module api/tasks/submitTask
 *
 * @description
 * POST /api/tasks/submit
 *
 * Accepts async task requests and queues them for background processing.
 * Returns immediately with a job_id that can be used to poll status.
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
  getLicenseByKey,
  createJob,
  checkPendingJobsLimit,
  createAuditLog,
  checkAndIncrementRateLimit,
} from "../../lib/firestore";
import {
  SubmitTaskRequest,
  isValidJobTaskType,
  validateTaskData,
  estimateProcessingTime,
  TASK_RATE_LIMIT_PER_MINUTE,
  BulkArticlesTaskData,
  BulkProductsTaskData,
  DesignBatchTaskData,
} from "../../types/Job";
import { QUOTA_EXCEEDED_THRESHOLD } from "../../types/Route";

/**
 * Maximum pending jobs per license
 */
const MAX_PENDING_JOBS = 5;

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
 * Gets the item count from task data
 *
 * @param {string} taskType - The task type
 * @param {unknown} taskData - The task data
 * @returns {number} Number of items
 */
function getItemCount(taskType: string, taskData: unknown): number {
  const data = taskData as Record<string, unknown>;

  switch (taskType) {
    case "bulk_articles":
      return Array.isArray(data.topics) ? data.topics.length : 0;
    case "bulk_products":
      return Array.isArray(data.products) ? data.products.length : 0;
    case "design_batch":
      return Array.isArray(data.sections) ? data.sections.length : 0;
    default:
      return 0;
  }
}

/**
 * POST /api/tasks/submit
 *
 * Submits an async task for background processing.
 *
 * @description
 * Request body:
 * ```json
 * {
 *   "task_type": "bulk_articles" | "bulk_products" | "design_batch",
 *   "task_data": {
 *     // For bulk_articles:
 *     "topics": ["topic1", "topic2"],
 *     "tone": "professional",
 *     "language": "en",
 *     "word_count": 800,
 *     "include_seo": true
 *
 *     // For bulk_products:
 *     "products": [{ "name": "Product", "category": "Category" }],
 *     "language": "en"
 *
 *     // For design_batch:
 *     "sections": [{ "name": "Hero", "description": "...", "style": "modern" }]
 *   }
 * }
 * ```
 *
 * Required headers:
 * - Authorization: Bearer {site_token}
 *
 * Success response (202 Accepted):
 * ```json
 * {
 *   "success": true,
 *   "job_id": "job_f47ac10b-58cc-4372-a567-0e02b2c3d479",
 *   "status": "pending",
 *   "estimated_wait_seconds": 45
 * }
 * ```
 *
 * Error responses:
 * - 400: Invalid request body or task_data
 * - 401: Missing or invalid Authorization header
 * - 403: License suspended/expired, quota exceeded
 * - 429: Rate limited or too many pending jobs
 */
export const submitTask = onRequest(
  {
    secrets: [jwtSecret],
    cors: true,
    maxInstances: 50,
  },
  async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const ipAddress = getClientIP(req);
    const logger = createRequestLogger(requestId, "/api/tasks/submit", ipAddress);

    // Only allow POST
    if (req.method !== "POST") {
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

      // 2. Rate limiting (per license, 10 task submissions per min)
      const rateLimitKey = `task_submit:${licenseId}`;
      const { limited, count } = await checkAndIncrementRateLimit(
        rateLimitKey,
        ipAddress,
        TASK_RATE_LIMIT_PER_MINUTE
      );

      if (limited) {
        logger.warn("Rate limited", { license_id: licenseId, count });
        res.status(429).json({
          success: false,
          error: "Too many task submissions. Please try again later.",
          code: "RATE_LIMITED",
        });
        return;
      }

      // 3. Check pending jobs limit
      const { allowed, pendingCount } = await checkPendingJobsLimit(licenseId, MAX_PENDING_JOBS);

      if (!allowed) {
        logger.warn("Too many pending jobs", { license_id: licenseId, pending_count: pendingCount });
        res.status(429).json({
          success: false,
          error: `Maximum ${MAX_PENDING_JOBS} pending jobs allowed. Please wait for current jobs to complete.`,
          code: "TOO_MANY_PENDING_JOBS",
        });
        return;
      }

      // 4. Validate request body
      const body = req.body as SubmitTaskRequest;

      if (!body || typeof body !== "object") {
        logger.warn("Invalid request body");
        res.status(400).json({
          success: false,
          error: "Request body is required",
          code: "INVALID_REQUEST",
        });
        return;
      }

      // Validate task_type
      if (!body.task_type || !isValidJobTaskType(body.task_type)) {
        logger.warn("Invalid task type", { task_type: body.task_type });
        res.status(400).json({
          success: false,
          error: "Invalid task_type. Must be one of: bulk_articles, bulk_products, design_batch",
          code: "INVALID_TASK_TYPE",
        });
        return;
      }

      // Validate task_data
      if (!body.task_data) {
        logger.warn("Missing task_data");
        res.status(400).json({
          success: false,
          error: "task_data is required",
          code: "MISSING_TASK_DATA",
        });
        return;
      }

      const taskDataValidation = validateTaskData(body.task_type, body.task_data);
      if (!taskDataValidation.valid) {
        logger.warn("Invalid task_data", { error: taskDataValidation.error });
        res.status(400).json({
          success: false,
          error: taskDataValidation.error,
          code: "INVALID_TASK_DATA",
        });
        return;
      }

      // 5. Check quota
      const license = await getLicenseByKey(licenseId);

      if (!license) {
        logger.error("License not found after auth", { license_id: licenseId });
        res.status(500).json({
          success: false,
          error: "Internal error",
          code: "INTERNAL_ERROR",
        });
        return;
      }

      const tokensRemaining = license.tokens_limit - license.tokens_used;

      if (tokensRemaining < QUOTA_EXCEEDED_THRESHOLD) {
        logger.warn("Quota exceeded", {
          license_id: licenseId,
          tokens_remaining: tokensRemaining,
        });

        await createAuditLog({
          license_id: licenseId,
          request_type: "task_submission",
          status: "failed",
          error_message: "Quota exceeded",
          ip_address: ipAddress,
        });

        res.status(403).json({
          success: false,
          error: "Token quota exceeded. Please upgrade your plan.",
          code: "QUOTA_EXCEEDED",
        });
        return;
      }

      // 6. Create job in queue
      const itemCount = getItemCount(body.task_type, body.task_data);
      const estimatedTime = estimateProcessingTime(body.task_type, itemCount);

      const job = await createJob({
        license_id: licenseId,
        task_type: body.task_type,
        task_data: body.task_data as BulkArticlesTaskData | BulkProductsTaskData | DesignBatchTaskData,
      });

      // 7. Create audit log
      await createAuditLog({
        license_id: licenseId,
        request_type: "task_submission",
        status: "success",
        ip_address: ipAddress,
      });

      logger.info("Task submitted successfully", {
        license_id: licenseId,
        job_id: job.job_id,
        task_type: body.task_type,
        item_count: itemCount,
        estimated_time: estimatedTime,
      });

      // 8. Return response
      res.status(202).json({
        success: true,
        job_id: job.job_id,
        status: "pending",
        estimated_wait_seconds: estimatedTime,
      });
    } catch (error) {
      logger.error("Unhandled error in submit-task", {
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
