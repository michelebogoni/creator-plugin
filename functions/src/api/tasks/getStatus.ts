/**
 * @fileoverview Get Task Status Endpoint for Creator AI Proxy
 * @module api/tasks/getStatus
 *
 * @description
 * GET /api/tasks/status/:job_id
 *
 * Retrieves the current status of an async job, including progress
 * and results when completed.
 *
 * Requires: Bearer token authentication (site_token)
 */

import { onRequest } from "firebase-functions/v2/https";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { jwtSecret } from "../../lib/secrets";
import { createRequestLogger } from "../../lib/logger";
import { authenticateRequest, sendAuthErrorResponse } from "../../middleware/auth";
import { getJobById, timestampToISO } from "../../lib/firestore";
import { GetStatusResponseSuccess } from "../../types/Job";

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
 * Extracts job_id from URL path
 * Supports both /api/tasks/status/:job_id and query param ?job_id=xxx
 *
 * @param {Request} req - The request object
 * @returns {string | null} The job ID or null
 */
function extractJobId(req: Request): string | null {
  // Try to get from path: /api/tasks/status/job_xxx
  const pathParts = req.path.split("/");
  const statusIndex = pathParts.indexOf("status");

  if (statusIndex !== -1 && pathParts[statusIndex + 1]) {
    return pathParts[statusIndex + 1];
  }

  // Try to get from query param
  if (req.query.job_id && typeof req.query.job_id === "string") {
    return req.query.job_id;
  }

  return null;
}

/**
 * GET /api/tasks/status/:job_id
 *
 * Retrieves the status of an async job.
 *
 * @description
 * URL params:
 * - job_id: The job ID returned from /api/tasks/submit
 *
 * Required headers:
 * - Authorization: Bearer {site_token}
 *
 * Success response (200 - Pending/Processing):
 * ```json
 * {
 *   "success": true,
 *   "job_id": "job_...",
 *   "status": "processing",
 *   "progress": {
 *     "progress_percent": 30,
 *     "items_completed": 3,
 *     "items_total": 10,
 *     "current_item_index": 3,
 *     "current_item_title": "Generating article: WordPress Security",
 *     "eta_seconds": 210
 *   },
 *   "created_at": "2025-11-25T15:00:00Z",
 *   "started_at": "2025-11-25T15:00:05Z"
 * }
 * ```
 *
 * Success response (200 - Completed):
 * ```json
 * {
 *   "success": true,
 *   "job_id": "job_...",
 *   "status": "completed",
 *   "progress": { "progress_percent": 100, ... },
 *   "result": { ... },
 *   "created_at": "2025-11-25T15:00:00Z",
 *   "started_at": "2025-11-25T15:00:05Z",
 *   "completed_at": "2025-11-25T15:05:00Z"
 * }
 * ```
 *
 * Success response (200 - Failed):
 * ```json
 * {
 *   "success": true,
 *   "job_id": "job_...",
 *   "status": "failed",
 *   "error": "Timeout exceeded",
 *   "created_at": "2025-11-25T15:00:00Z",
 *   "completed_at": "2025-11-25T15:10:00Z"
 * }
 * ```
 *
 * Error responses:
 * - 400: Missing job_id
 * - 401: Missing or invalid Authorization header
 * - 403: Job belongs to different license
 * - 404: Job not found
 */
export const getTaskStatus = onRequest(
  {
    secrets: [jwtSecret],
    cors: true,
    maxInstances: 100,
  },
  async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const ipAddress = getClientIP(req);
    const logger = createRequestLogger(requestId, "/api/tasks/status", ipAddress);

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

      // 2. Extract job_id from URL
      const jobId = extractJobId(req);

      if (!jobId) {
        logger.warn("Missing job_id");
        res.status(400).json({
          success: false,
          error: "job_id is required",
          code: "MISSING_JOB_ID",
        });
        return;
      }

      // Validate job_id format
      if (!jobId.startsWith("job_")) {
        logger.warn("Invalid job_id format", { job_id: jobId });
        res.status(400).json({
          success: false,
          error: "Invalid job_id format",
          code: "INVALID_JOB_ID",
        });
        return;
      }

      // 3. Retrieve job from Firestore
      const job = await getJobById(jobId);

      if (!job) {
        logger.warn("Job not found", { job_id: jobId });
        res.status(404).json({
          success: false,
          error: "Job not found",
          code: "JOB_NOT_FOUND",
        });
        return;
      }

      // 4. Verify job belongs to this license
      if (job.license_id !== licenseId) {
        logger.warn("Job belongs to different license", {
          job_id: jobId,
          job_license: job.license_id,
          request_license: licenseId,
        });
        res.status(403).json({
          success: false,
          error: "Access denied",
          code: "ACCESS_DENIED",
        });
        return;
      }

      // 5. Build response
      const response: GetStatusResponseSuccess = {
        success: true,
        job_id: job.job_id,
        status: job.status,
        created_at: timestampToISO(job.created_at),
      };

      // Add progress if available
      if (job.progress) {
        response.progress = job.progress;
      }

      // Add started_at if available
      if (job.started_at) {
        response.started_at = timestampToISO(job.started_at);
      }

      // Add result if completed
      if (job.status === "completed" && job.result) {
        response.result = job.result;
        if (job.completed_at) {
          response.completed_at = timestampToISO(job.completed_at);
        }
      }

      // Add error if failed
      if (job.status === "failed") {
        response.error = job.error_message;
        if (job.completed_at) {
          response.completed_at = timestampToISO(job.completed_at);
        }
      }

      logger.debug("Job status retrieved", {
        job_id: jobId,
        status: job.status,
        progress_percent: job.progress?.progress_percent,
      });

      res.status(200).json(response);
    } catch (error) {
      logger.error("Unhandled error in get-status", {
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
