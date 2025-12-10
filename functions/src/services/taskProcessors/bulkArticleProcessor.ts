/**
 * @fileoverview Bulk Article Processor for generating multiple articles
 * @module services/taskProcessors/bulkArticleProcessor
 *
 * @description
 * Processes bulk_articles jobs by generating articles for each topic
 * using the AI router with TEXT_GEN task type.
 */

import { AIRouter, ProviderKeys } from "../aiRouter";
import { Logger } from "../../lib/logger";
import { updateJobProgress } from "../../lib/firestore";
import {
  BulkArticlesTaskData,
  BulkArticlesResult,
  ArticleResult,
  JobProgress,
  JOB_TIMEOUT_MS,
} from "../../types/Job";

/**
 * Context for article generation progress tracking
 */
interface ProcessingContext {
  jobId: string;
  startTime: number;
  itemTimes: number[];
}

/**
 * Builds a prompt for article generation
 *
 * @param {string} topic - The article topic
 * @param {BulkArticlesTaskData} taskData - Task configuration
 * @returns {string} The formatted prompt
 */
function buildArticlePrompt(
  topic: string,
  taskData: BulkArticlesTaskData
): string {
  const tone = taskData.tone || "professional";
  const language = taskData.language || "en";
  const wordCount = taskData.word_count || 800;
  const includeSeo = taskData.include_seo !== false;

  let prompt = `Write a comprehensive article about "${topic}".

Requirements:
- Tone: ${tone}
- Language: ${language}
- Target length: approximately ${wordCount} words
- Format: HTML with proper headings (h2, h3), paragraphs, and lists where appropriate
- Include an engaging introduction and a clear conclusion
- Make the content informative and well-structured`;

  if (includeSeo) {
    prompt += `
- At the end, provide SEO metadata in the following JSON format:
\`\`\`json
{
  "meta_title": "SEO optimized title (max 60 chars)",
  "meta_description": "SEO optimized description (max 160 chars)",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}
\`\`\``;
  }

  return prompt;
}

/**
 * Parses the AI response to extract content and SEO metadata
 *
 * @param {string} content - Raw AI response
 * @param {boolean} includeSeo - Whether to parse SEO metadata
 * @returns {{ content: string; seo?: ArticleResult["seo"] }}
 */
function parseArticleResponse(
  content: string,
  includeSeo: boolean
): { content: string; seo?: ArticleResult["seo"] } {
  if (!includeSeo) {
    return { content };
  }

  // Try to extract JSON SEO metadata from the response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    try {
      const seoData = JSON.parse(jsonMatch[1]);
      const cleanContent = content.replace(/```json[\s\S]*?```/, "").trim();

      return {
        content: cleanContent,
        seo: {
          meta_title: seoData.meta_title,
          meta_description: seoData.meta_description,
          keywords: seoData.keywords,
        },
      };
    } catch {
      // JSON parsing failed, return content as-is
      return { content };
    }
  }

  return { content };
}

/**
 * Calculates estimated time remaining
 *
 * @param {ProcessingContext} ctx - Processing context
 * @param {number} itemsRemaining - Items left to process
 * @returns {number} ETA in seconds
 */
function calculateEta(ctx: ProcessingContext, itemsRemaining: number): number {
  if (ctx.itemTimes.length === 0) {
    return itemsRemaining * 15; // Default 15s per item
  }

  const avgTime = ctx.itemTimes.reduce((a, b) => a + b, 0) / ctx.itemTimes.length;
  return Math.round((itemsRemaining * avgTime) / 1000);
}

/**
 * Updates job progress during processing
 *
 * @param {ProcessingContext} ctx - Processing context
 * @param {number} completed - Items completed
 * @param {number} total - Total items
 * @param {string} currentTitle - Current item being processed
 * @param {Logger} logger - Logger instance
 */
async function updateProgress(
  ctx: ProcessingContext,
  completed: number,
  total: number,
  currentTitle: string,
  logger: Logger
): Promise<void> {
  const progress: JobProgress = {
    progress_percent: Math.round((completed / total) * 100),
    items_completed: completed,
    items_total: total,
    current_item_index: completed,
    current_item_title: currentTitle,
    eta_seconds: calculateEta(ctx, total - completed),
  };

  try {
    await updateJobProgress(ctx.jobId, progress);
  } catch (error) {
    logger.warn("Failed to update progress", {
      job_id: ctx.jobId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Checks if the job has exceeded the timeout
 *
 * @param {number} startTime - Job start timestamp
 * @returns {boolean} True if timeout exceeded
 */
function isTimeoutExceeded(startTime: number): boolean {
  return Date.now() - startTime > JOB_TIMEOUT_MS;
}

/**
 * Processes a bulk_articles job
 *
 * @param {string} jobId - The job ID
 * @param {BulkArticlesTaskData} taskData - Task input data
 * @param {AIRouter} router - AI router instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<BulkArticlesResult>} Processing result
 *
 * @throws {Error} If timeout is exceeded
 *
 * @example
 * ```typescript
 * const result = await processBulkArticles(
 *   "job_xxx",
 *   { topics: ["SEO", "WordPress"], tone: "professional" },
 *   router,
 *   logger
 * );
 * ```
 */
export async function processBulkArticles(
  jobId: string,
  taskData: BulkArticlesTaskData,
  router: AIRouter,
  logger: Logger
): Promise<BulkArticlesResult> {
  const processingLogger = logger.child({ processor: "bulkArticles", job_id: jobId });
  const startTime = Date.now();

  const ctx: ProcessingContext = {
    jobId,
    startTime,
    itemTimes: [],
  };

  const topics = taskData.topics;
  const includeSeo = taskData.include_seo !== false;
  const articles: ArticleResult[] = [];

  let totalTokens = 0;
  let totalCost = 0;

  processingLogger.info("Starting bulk article generation", {
    topic_count: topics.length,
    tone: taskData.tone,
    language: taskData.language,
  });

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const itemStartTime = Date.now();

    // Check timeout before processing each item
    if (isTimeoutExceeded(startTime)) {
      processingLogger.error("Job timeout exceeded", {
        processed: i,
        total: topics.length,
        elapsed_ms: Date.now() - startTime,
      });
      throw new Error(`Job timeout: processed ${i} of ${topics.length} articles before timeout`);
    }

    // Update progress
    await updateProgress(ctx, i, topics.length, `Generating article: ${topic}`, processingLogger);

    processingLogger.debug("Processing topic", {
      index: i,
      topic,
      remaining: topics.length - i - 1,
    });

    try {
      const prompt = buildArticlePrompt(topic, taskData);
      const result = await router.route("TEXT_GEN", prompt, {
        temperature: 0.7,
        max_tokens: 4000,
      });

      const itemTime = Date.now() - itemStartTime;
      ctx.itemTimes.push(itemTime);

      if (result.success) {
        const parsed = parseArticleResponse(result.content, includeSeo);

        articles.push({
          topic,
          title: `${topic}`, // Could be extracted from content
          content: parsed.content,
          tokens_used: result.total_tokens,
          cost: result.cost_usd,
          provider: result.provider,
          status: "success",
          seo: parsed.seo,
        });

        totalTokens += result.total_tokens;
        totalCost += result.cost_usd;

        processingLogger.debug("Article generated successfully", {
          topic,
          tokens: result.total_tokens,
          cost: result.cost_usd,
          time_ms: itemTime,
        });
      } else {
        articles.push({
          topic,
          title: topic,
          content: "",
          tokens_used: 0,
          cost: 0,
          provider: result.provider,
          status: "failed",
          error: result.error || "Generation failed",
        });

        processingLogger.warn("Article generation failed", {
          topic,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      articles.push({
        topic,
        title: topic,
        content: "",
        tokens_used: 0,
        cost: 0,
        provider: "gemini", // Default, may not be accurate
        status: "failed",
        error: errorMessage,
      });

      processingLogger.error("Exception during article generation", {
        topic,
        error: errorMessage,
      });
    }
  }

  // Final progress update
  await updateProgress(ctx, topics.length, topics.length, "Completed", processingLogger);

  const processingTime = Math.round((Date.now() - startTime) / 1000);

  processingLogger.info("Bulk article generation completed", {
    total_articles: articles.length,
    successful: articles.filter((a) => a.status === "success").length,
    failed: articles.filter((a) => a.status === "failed").length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  });

  return {
    articles,
    total_articles: articles.length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  };
}

/**
 * Creates an AI router instance with provided keys
 *
 * @param {ProviderKeys} keys - Provider API keys
 * @param {Logger} logger - Logger instance
 * @returns {AIRouter} Configured router
 */
export function createRouter(keys: ProviderKeys, logger: Logger): AIRouter {
  return new AIRouter(keys, logger);
}
