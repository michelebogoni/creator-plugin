/**
 * @fileoverview AI Route Request Endpoint for Creator AI Proxy
 * @module api/ai/routeRequest
 *
 * @description
 * POST /api/ai/route-request
 *
 * Routes AI generation requests to the selected model (Gemini or Claude)
 * with automatic fallback to the other model if primary fails.
 *
 * Requires: Bearer token authentication (site_token)
 */

import { onRequest } from "firebase-functions/v2/https";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { jwtSecret, geminiApiKey, claudeApiKey } from "../../lib/secrets";
import { createRequestLogger } from "../../lib/logger";
import { authenticateRequest, sendAuthErrorResponse } from "../../middleware/auth";
import {
  getLicenseByKey,
  incrementTokensUsed,
  createAuditLog,
  updateCostTracking,
  checkAndIncrementRateLimit,
} from "../../lib/firestore";
import { sanitizePrompt, validatePrompt } from "../../services/aiRouter";
import { ModelService } from "../../services/modelService";
import {
  AIModel,
  isValidProvider,
} from "../../types/ModelConfig";
import {
  RouteRequest,
  isValidTaskType,
  MAX_PROMPT_LENGTH,
  LOW_QUOTA_WARNING_THRESHOLD,
  QUOTA_EXCEEDED_THRESHOLD,
  AI_RATE_LIMIT_PER_MINUTE,
} from "../../types/Route";

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
 * POST /api/ai/route-request
 *
 * Routes an AI generation request to the selected model with fallback.
 *
 * @description
 * Request body:
 * ```json
 * {
 *   "task_type": "TEXT_GEN" | "CODE_GEN" | "DESIGN_GEN" | "ECOMMERCE_GEN",
 *   "prompt": "string (max 10000 chars)",
 *   "model": "gemini" | "claude",
 *   "context": { optional site context },
 *   "system_prompt": "optional system prompt",
 *   "temperature": 0.7,
 *   "max_tokens": 4096
 * }
 * ```
 *
 * Required headers:
 * - Authorization: Bearer {site_token}
 *
 * Success response (200):
 * ```json
 * {
 *   "success": true,
 *   "content": "generated content",
 *   "model": "gemini",
 *   "model_id": "gemini-3-pro-preview",
 *   "used_fallback": false,
 *   "tokens_used": 1250,
 *   "cost_usd": 0.0942,
 *   "latency_ms": 2341
 * }
 * ```
 *
 * Error responses:
 * - 401: Missing or invalid Authorization header
 * - 403: License suspended/expired, URL mismatch, quota exceeded
 * - 400: Invalid request body
 * - 429: Rate limited
 * - 503: All providers failed
 */
export const routeRequest = onRequest(
  {
    secrets: [jwtSecret, geminiApiKey, claudeApiKey],
    cors: true,
    maxInstances: 100,
    timeoutSeconds: 120, // Increased for longer model responses
  },
  async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const ipAddress = getClientIP(req);
    const logger = createRequestLogger(requestId, "/api/ai/route-request", ipAddress);

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

      // 2. Rate limiting (per license, 100 req/min)
      const rateLimitKey = `ai_route:${licenseId}`;
      const { limited, count } = await checkAndIncrementRateLimit(
        rateLimitKey,
        ipAddress,
        AI_RATE_LIMIT_PER_MINUTE
      );

      if (limited) {
        logger.warn("Rate limited", { license_id: licenseId, count });
        res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
          code: "RATE_LIMITED",
        });
        return;
      }

      // 3. Validate request body
      const body = req.body as RouteRequest;

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
      if (!body.task_type || !isValidTaskType(body.task_type)) {
        logger.warn("Invalid task type", { task_type: body.task_type });
        res.status(400).json({
          success: false,
          error: "Invalid task_type. Must be one of: TEXT_GEN, CODE_GEN, DESIGN_GEN, ECOMMERCE_GEN",
          code: "INVALID_TASK_TYPE",
        });
        return;
      }

      // Validate and sanitize prompt
      const promptValidation = validatePrompt(body.prompt, MAX_PROMPT_LENGTH);
      if (!promptValidation.valid) {
        logger.warn("Invalid prompt", { error: promptValidation.error });
        res.status(400).json({
          success: false,
          error: promptValidation.error,
          code: "INVALID_PROMPT",
        });
        return;
      }

      const sanitizedPrompt = sanitizePrompt(body.prompt);

      // Validate model if provided (default to gemini)
      const requestedModel = (body.model as string) || "gemini";
      if (!isValidProvider(requestedModel)) {
        logger.warn("Invalid model", { model: requestedModel });
        res.status(400).json({
          success: false,
          error: "Invalid model. Must be 'gemini' or 'claude'",
          code: "INVALID_MODEL",
        });
        return;
      }

      // requestedModel is now type-narrowed to AIModel via isValidProvider type guard
      const selectedModel: AIModel = requestedModel;

      // 4. Check quota
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

      // Quota exceeded check
      if (tokensRemaining < QUOTA_EXCEEDED_THRESHOLD) {
        logger.warn("Quota exceeded", {
          license_id: licenseId,
          tokens_remaining: tokensRemaining,
        });

        await createAuditLog({
          license_id: licenseId,
          request_type: "ai_request",
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

      // Low quota warning (included in response header)
      if (tokensRemaining < LOW_QUOTA_WARNING_THRESHOLD) {
        res.setHeader("X-Quota-Warning", "low");
        res.setHeader("X-Tokens-Remaining", tokensRemaining.toString());
      }

      // 5. Execute model request with fallback
      const modelService = new ModelService(
        {
          gemini: geminiApiKey.value(),
          claude: claudeApiKey.value(),
        },
        logger
      );

      // Extract files from body.files or body.options.files (backwards compatibility)
      const files = body.files || body.options?.files;

      const result = await modelService.generate({
        model: selectedModel,
        prompt: sanitizedPrompt,
        context: body.context,
        system_prompt: body.system_prompt,
        chat_id: body.chat_id,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        files: files,
      });

      // 6. Handle result
      if (result.success) {
        // Update license tokens
        await incrementTokensUsed(licenseId, result.total_tokens);

        // Update cost tracking
        await updateCostTracking(
          licenseId,
          result.model === "gemini" ? "gemini" : "claude",
          result.tokens_input,
          result.tokens_output,
          result.cost_usd
        );

        // Create audit log
        await createAuditLog({
          license_id: licenseId,
          request_type: "ai_request",
          provider_used: result.model === "gemini" ? "gemini" : "claude",
          tokens_input: result.tokens_input,
          tokens_output: result.tokens_output,
          cost_usd: result.cost_usd,
          status: "success",
          response_time_ms: result.latency_ms,
          ip_address: ipAddress,
          metadata: {
            model: result.model,
            model_id: result.model_id,
            used_fallback: result.used_fallback,
          },
        });

        logger.info("Request completed successfully", {
          license_id: licenseId,
          task_type: body.task_type,
          model: result.model,
          used_fallback: result.used_fallback,
          tokens_used: result.total_tokens,
          cost_usd: result.cost_usd,
        });

        res.status(200).json({
          success: true,
          content: result.content,
          model: result.model,
          model_id: result.model_id,
          used_fallback: result.used_fallback,
          tokens_used: result.total_tokens,
          cost_usd: result.cost_usd,
          latency_ms: result.latency_ms,
        });
      } else {
        // All models failed
        await createAuditLog({
          license_id: licenseId,
          request_type: "ai_request",
          status: "failed",
          error_message: result.error || "All models failed",
          ip_address: ipAddress,
          metadata: {
            model: selectedModel,
            used_fallback: result.used_fallback,
          },
        });

        logger.error("All models failed", {
          license_id: licenseId,
          task_type: body.task_type,
          model: selectedModel,
          error: result.error,
        });

        res.status(503).json({
          success: false,
          error: result.error || "Service temporarily unavailable. Please try again later.",
          code: result.error_code || "SERVICE_UNAVAILABLE",
          model: selectedModel,
        });
      }
    } catch (error) {
      logger.error("Unhandled error in route-request", {
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
