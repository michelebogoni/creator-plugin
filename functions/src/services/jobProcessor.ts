/**
 * @fileoverview Job Processor Service - Main background worker logic
 * @module services/jobProcessor
 *
 * @description
 * Coordinates the processing of async jobs from the job_queue.
 * Handles routing to specific task processors, retry logic,
 * and updates to Firestore.
 */

import { AIRouter, ProviderKeys } from "./aiRouter";
import { Logger } from "../lib/logger";
import {
  updateJob,
  updateJobStatus,
  failJob,
  incrementJobAttempts,
  incrementTokensUsed,
  updateCostTracking,
} from "../lib/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  Job,
  JobResult,
  BulkArticlesTaskData,
  BulkProductsTaskData,
  DesignBatchTaskData,
  BulkArticlesResult,
  BulkProductsResult,
  DesignBatchResult,
  MAX_JOB_ATTEMPTS,
} from "../types/Job";
import { processBulkArticles } from "./taskProcessors/bulkArticleProcessor";
import { processBulkProducts } from "./taskProcessors/bulkProductProcessor";
import { processDesignBatch } from "./taskProcessors/designBatchProcessor";

/**
 * Result from job processing
 */
export interface JobProcessingResult {
  /** Whether processing succeeded */
  success: boolean;

  /** Job result if successful */
  result?: JobResult;

  /** Error message if failed */
  error?: string;

  /** Total tokens used */
  totalTokens: number;

  /** Total cost in USD */
  totalCost: number;

  /** Provider used (most common) */
  provider?: "openai" | "gemini" | "claude";
}

/**
 * Determines the most used provider from results
 *
 * @param {JobResult} result - The job result
 * @returns {"openai" | "gemini" | "claude"} Most used provider
 */
function getMostUsedProvider(result: JobResult): "openai" | "gemini" | "claude" {
  const providerCounts: Record<string, number> = {
    openai: 0,
    gemini: 0,
    claude: 0,
  };

  if ("articles" in result) {
    for (const article of result.articles) {
      if (article.provider) {
        providerCounts[article.provider]++;
      }
    }
  } else if ("products" in result) {
    for (const product of result.products) {
      if (product.provider) {
        providerCounts[product.provider]++;
      }
    }
  } else if ("sections" in result) {
    for (const section of result.sections) {
      if (section.provider) {
        providerCounts[section.provider]++;
      }
    }
  }

  let maxProvider: "openai" | "gemini" | "claude" = "gemini";
  let maxCount = 0;

  for (const [provider, count] of Object.entries(providerCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxProvider = provider as "openai" | "gemini" | "claude";
    }
  }

  return maxProvider;
}

/**
 * Processes a job based on its task type
 *
 * @param {Job} job - The job to process
 * @param {AIRouter} router - AI router instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<JobProcessingResult>} Processing result
 */
async function processJobByType(
  job: Job,
  router: AIRouter,
  logger: Logger
): Promise<JobProcessingResult> {
  const taskType = job.task_type;

  try {
    let result: JobResult;

    switch (taskType) {
      case "bulk_articles": {
        const taskData = job.task_data as BulkArticlesTaskData;
        result = await processBulkArticles(job.job_id, taskData, router, logger);
        const articlesResult = result as BulkArticlesResult;
        return {
          success: true,
          result,
          totalTokens: articlesResult.total_tokens,
          totalCost: articlesResult.total_cost,
          provider: getMostUsedProvider(result),
        };
      }

      case "bulk_products": {
        const taskData = job.task_data as BulkProductsTaskData;
        result = await processBulkProducts(job.job_id, taskData, router, logger);
        const productsResult = result as BulkProductsResult;
        return {
          success: true,
          result,
          totalTokens: productsResult.total_tokens,
          totalCost: productsResult.total_cost,
          provider: getMostUsedProvider(result),
        };
      }

      case "design_batch": {
        const taskData = job.task_data as DesignBatchTaskData;
        result = await processDesignBatch(job.job_id, taskData, router, logger);
        const designResult = result as DesignBatchResult;
        return {
          success: true,
          result,
          totalTokens: designResult.total_tokens,
          totalCost: designResult.total_cost,
          provider: getMostUsedProvider(result),
        };
      }

      default:
        return {
          success: false,
          error: `Unknown task type: ${taskType}`,
          totalTokens: 0,
          totalCost: 0,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: errorMessage,
      totalTokens: 0,
      totalCost: 0,
    };
  }
}

/**
 * Calculates exponential backoff delay
 *
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt: number): number {
  // 1s, 2s, 4s for attempts 0, 1, 2
  return Math.pow(2, attempt) * 1000;
}

/**
 * Sleeps for a specified duration
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main job processor - processes a job with retry logic
 *
 * @param {Job} job - The job to process
 * @param {ProviderKeys} keys - API keys for providers
 * @param {Logger} logger - Logger instance
 * @returns {Promise<void>}
 *
 * @description
 * This function:
 * 1. Sets job status to "processing"
 * 2. Attempts to process the job
 * 3. On failure, retries with exponential backoff (up to MAX_JOB_ATTEMPTS)
 * 4. Updates Firestore with results
 * 5. Updates license token usage and cost tracking
 *
 * @example
 * ```typescript
 * await processJob(job, providerKeys, logger);
 * ```
 */
export async function processJob(
  job: Job,
  keys: ProviderKeys,
  logger: Logger
): Promise<void> {
  const processingLogger = logger.child({
    job_id: job.job_id,
    task_type: job.task_type,
    license_id: job.license_id,
  });

  processingLogger.info("Starting job processing", {
    attempt: job.attempts + 1,
    max_attempts: job.max_attempts,
  });

  // Set status to processing
  await updateJobStatus(job.job_id, "processing");

  // Create router
  const router = new AIRouter(keys, logger);

  let currentAttempt = job.attempts;
  let lastError: string | undefined;

  while (currentAttempt < MAX_JOB_ATTEMPTS) {
    processingLogger.debug("Processing attempt", {
      attempt: currentAttempt + 1,
      max_attempts: MAX_JOB_ATTEMPTS,
    });

    const result = await processJobByType(job, router, processingLogger);

    if (result.success && result.result) {
      // Job succeeded
      processingLogger.info("Job completed successfully", {
        total_tokens: result.totalTokens,
        total_cost: result.totalCost,
        provider: result.provider,
      });

      // Update job as completed
      await updateJob(job.job_id, {
        status: "completed",
        result: result.result,
        tokens_used: result.totalTokens,
        cost_usd: result.totalCost,
        completed_at: Timestamp.now(),
      });

      // Update license token usage
      if (result.totalTokens > 0) {
        await incrementTokensUsed(job.license_id, result.totalTokens);
      }

      // Update cost tracking
      if (result.totalCost > 0 && result.provider) {
        // Calculate token split (approximate)
        const inputTokens = Math.round(result.totalTokens * 0.4);
        const outputTokens = result.totalTokens - inputTokens;

        await updateCostTracking(
          job.license_id,
          result.provider,
          inputTokens,
          outputTokens,
          result.totalCost
        );
      }

      return;
    }

    // Job failed
    lastError = result.error || "Unknown error";
    currentAttempt++;

    if (currentAttempt < MAX_JOB_ATTEMPTS) {
      // Increment attempts in Firestore
      await incrementJobAttempts(job.job_id);

      // Calculate backoff delay
      const delay = getBackoffDelay(currentAttempt - 1);

      processingLogger.warn("Job attempt failed, retrying", {
        attempt: currentAttempt,
        max_attempts: MAX_JOB_ATTEMPTS,
        error: lastError,
        retry_delay_ms: delay,
      });

      // Wait before retry
      await sleep(delay);

      // Reset status to processing for retry
      await updateJobStatus(job.job_id, "processing");
    }
  }

  // All retries exhausted
  processingLogger.error("Job failed after all retries", {
    attempts: currentAttempt,
    error: lastError,
  });

  await failJob(job.job_id, lastError || "Job failed after all retries");
}

/**
 * Validates that a job can be processed
 *
 * @param {Job} job - The job to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validateJob(job: Job): { valid: boolean; error?: string } {
  if (!job.job_id) {
    return { valid: false, error: "Missing job_id" };
  }

  if (!job.license_id) {
    return { valid: false, error: "Missing license_id" };
  }

  if (!job.task_type) {
    return { valid: false, error: "Missing task_type" };
  }

  if (!job.task_data) {
    return { valid: false, error: "Missing task_data" };
  }

  if (job.status !== "pending") {
    return { valid: false, error: `Invalid status for processing: ${job.status}` };
  }

  return { valid: true };
}

/**
 * Gets the item count for a job (for progress tracking)
 *
 * @param {Job} job - The job
 * @returns {number} Number of items to process
 */
export function getJobItemCount(job: Job): number {
  switch (job.task_type) {
    case "bulk_articles": {
      const data = job.task_data as BulkArticlesTaskData;
      return data.topics?.length || 0;
    }
    case "bulk_products": {
      const data = job.task_data as BulkProductsTaskData;
      return data.products?.length || 0;
    }
    case "design_batch": {
      const data = job.task_data as DesignBatchTaskData;
      return data.sections?.length || 0;
    }
    default:
      return 0;
  }
}
