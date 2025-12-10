/**
 * @fileoverview Bulk Product Processor for generating product descriptions
 * @module services/taskProcessors/bulkProductProcessor
 *
 * @description
 * Processes bulk_products jobs by generating product descriptions
 * using the AI router with ECOMMERCE_GEN task type.
 */

import { AIRouter } from "../aiRouter";
import { Logger } from "../../lib/logger";
import { updateJobProgress } from "../../lib/firestore";
import {
  BulkProductsTaskData,
  BulkProductsResult,
  ProductResult,
  ProductInput,
  JobProgress,
  JOB_TIMEOUT_MS,
} from "../../types/Job";

/**
 * Context for product generation progress tracking
 */
interface ProcessingContext {
  jobId: string;
  startTime: number;
  itemTimes: number[];
}

/**
 * Builds a prompt for product description generation
 *
 * @param {ProductInput} product - The product input
 * @param {BulkProductsTaskData} taskData - Task configuration
 * @returns {string} The formatted prompt
 */
function buildProductPrompt(
  product: ProductInput,
  taskData: BulkProductsTaskData
): string {
  const tone = taskData.tone || "professional";
  const language = taskData.language || "en";
  const includeSeo = taskData.include_seo !== false;

  let prompt = `Generate product descriptions for the following product:

Product Name: ${product.name}`;

  if (product.category) {
    prompt += `\nCategory: ${product.category}`;
  }

  if (product.specs) {
    prompt += `\nSpecifications: ${product.specs}`;
  }

  if (product.price) {
    prompt += `\nPrice: ${product.price}`;
  }

  if (product.context) {
    prompt += `\nAdditional Context: ${product.context}`;
  }

  prompt += `

Requirements:
- Tone: ${tone}
- Language: ${language}
- Generate TWO descriptions:
  1. Short description (2-3 sentences, max 150 characters)
  2. Long description (detailed, 200-300 words with bullet points for features)

Format your response as JSON:
\`\`\`json
{
  "short_desc": "Your short description here",
  "long_desc": "Your detailed HTML description here with <ul><li> for features"`;

  if (includeSeo) {
    prompt += `,
  "seo_title": "SEO optimized title (max 60 chars)",
  "seo_description": "SEO meta description (max 160 chars)"`;
  }

  prompt += `
}
\`\`\``;

  return prompt;
}

/**
 * Parses the AI response to extract product descriptions
 *
 * @param {string} content - Raw AI response
 * @param {string} productName - Product name for fallback
 * @returns {{ short_desc: string; long_desc: string; seo?: ProductResult["seo"] }}
 */
function parseProductResponse(
  content: string,
  productName: string
): { short_desc: string; long_desc: string; seo?: ProductResult["seo"] } {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      return {
        short_desc: data.short_desc || `${productName} - Quality product`,
        long_desc: data.long_desc || content,
        seo: data.seo_title || data.seo_description
          ? {
              seo_title: data.seo_title,
              seo_description: data.seo_description,
            }
          : undefined,
      };
    } catch {
      // JSON parsing failed
    }
  }

  // Fallback: try to parse without code blocks
  try {
    const data = JSON.parse(content);
    return {
      short_desc: data.short_desc || `${productName} - Quality product`,
      long_desc: data.long_desc || content,
      seo: data.seo_title || data.seo_description
        ? {
            seo_title: data.seo_title,
            seo_description: data.seo_description,
          }
        : undefined,
    };
  } catch {
    // Not JSON, use content as long description
    return {
      short_desc: `${productName} - Quality product`,
      long_desc: content,
    };
  }
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
    return itemsRemaining * 10; // Default 10s per product
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
 * Processes a bulk_products job
 *
 * @param {string} jobId - The job ID
 * @param {BulkProductsTaskData} taskData - Task input data
 * @param {AIRouter} router - AI router instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<BulkProductsResult>} Processing result
 *
 * @throws {Error} If timeout is exceeded
 *
 * @example
 * ```typescript
 * const result = await processBulkProducts(
 *   "job_xxx",
 *   {
 *     products: [{ name: "Laptop Pro 15", category: "Electronics" }],
 *     language: "it"
 *   },
 *   router,
 *   logger
 * );
 * ```
 */
export async function processBulkProducts(
  jobId: string,
  taskData: BulkProductsTaskData,
  router: AIRouter,
  logger: Logger
): Promise<BulkProductsResult> {
  const processingLogger = logger.child({ processor: "bulkProducts", job_id: jobId });
  const startTime = Date.now();

  const ctx: ProcessingContext = {
    jobId,
    startTime,
    itemTimes: [],
  };

  const products = taskData.products;
  const productResults: ProductResult[] = [];

  let totalTokens = 0;
  let totalCost = 0;

  processingLogger.info("Starting bulk product generation", {
    product_count: products.length,
    tone: taskData.tone,
    language: taskData.language,
  });

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const itemStartTime = Date.now();

    // Check timeout before processing each item
    if (isTimeoutExceeded(startTime)) {
      processingLogger.error("Job timeout exceeded", {
        processed: i,
        total: products.length,
        elapsed_ms: Date.now() - startTime,
      });
      throw new Error(`Job timeout: processed ${i} of ${products.length} products before timeout`);
    }

    // Update progress
    await updateProgress(
      ctx,
      i,
      products.length,
      `Generating description: ${product.name}`,
      processingLogger
    );

    processingLogger.debug("Processing product", {
      index: i,
      product_name: product.name,
      remaining: products.length - i - 1,
    });

    try {
      const prompt = buildProductPrompt(product, taskData);
      const result = await router.route("ECOMMERCE_GEN", prompt, {
        temperature: 0.7,
        max_tokens: 2000,
      });

      const itemTime = Date.now() - itemStartTime;
      ctx.itemTimes.push(itemTime);

      if (result.success) {
        const parsed = parseProductResponse(result.content, product.name);

        productResults.push({
          product_name: product.name,
          short_desc: parsed.short_desc,
          long_desc: parsed.long_desc,
          tokens_used: result.total_tokens,
          cost: result.cost_usd,
          provider: result.provider,
          status: "success",
          seo: parsed.seo,
        });

        totalTokens += result.total_tokens;
        totalCost += result.cost_usd;

        processingLogger.debug("Product description generated successfully", {
          product_name: product.name,
          tokens: result.total_tokens,
          cost: result.cost_usd,
          time_ms: itemTime,
        });
      } else {
        productResults.push({
          product_name: product.name,
          short_desc: "",
          long_desc: "",
          tokens_used: 0,
          cost: 0,
          provider: result.provider,
          status: "failed",
          error: result.error || "Generation failed",
        });

        processingLogger.warn("Product description generation failed", {
          product_name: product.name,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      productResults.push({
        product_name: product.name,
        short_desc: "",
        long_desc: "",
        tokens_used: 0,
        cost: 0,
        provider: "gemini", // Default, may not be accurate
        status: "failed",
        error: errorMessage,
      });

      processingLogger.error("Exception during product description generation", {
        product_name: product.name,
        error: errorMessage,
      });
    }
  }

  // Final progress update
  await updateProgress(ctx, products.length, products.length, "Completed", processingLogger);

  const processingTime = Math.round((Date.now() - startTime) / 1000);

  processingLogger.info("Bulk product generation completed", {
    total_products: productResults.length,
    successful: productResults.filter((p) => p.status === "success").length,
    failed: productResults.filter((p) => p.status === "failed").length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  });

  return {
    products: productResults,
    total_products: productResults.length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  };
}
