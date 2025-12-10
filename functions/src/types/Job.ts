/**
 * @fileoverview Job type definitions for async task processing
 * @module types/Job
 *
 * @description
 * Defines types for the job queue system that handles
 * asynchronous bulk operations like article generation,
 * product descriptions, and design batches.
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Supported job task types
 *
 * @description
 * - bulk_articles: Generate multiple articles from topics
 * - bulk_products: Generate product descriptions
 * - design_batch: Generate Elementor design sections
 */
export type JobTaskType = "bulk_articles" | "bulk_products" | "design_batch";

/**
 * Job status values
 *
 * @description
 * - pending: Job created, waiting to be processed
 * - processing: Job is currently being processed
 * - completed: Job finished successfully
 * - failed: Job failed after all retry attempts
 */
export type JobStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Progress tracking for a job
 *
 * @interface JobProgress
 */
export interface JobProgress {
  /** Progress percentage (0-100) */
  progress_percent: number;

  /** Number of items completed */
  items_completed: number;

  /** Total number of items to process */
  items_total: number;

  /** Current item index being processed (0-based) */
  current_item_index: number;

  /** Human-readable description of current item */
  current_item_title?: string;

  /** Estimated time remaining in seconds */
  eta_seconds?: number;
}

// ==================== TASK DATA TYPES ====================

/**
 * Input data for bulk_articles task
 *
 * @interface BulkArticlesTaskData
 */
export interface BulkArticlesTaskData {
  /** List of topics to generate articles for */
  topics: string[];

  /** Writing tone (professional, casual, technical, friendly) */
  tone?: "professional" | "casual" | "technical" | "friendly";

  /** Target language (ISO 639-1 code) */
  language?: string;

  /** Target word count per article */
  word_count?: number;

  /** Include SEO metadata (title, description, keywords) */
  include_seo?: boolean;
}

/**
 * Single product input for bulk_products task
 *
 * @interface ProductInput
 */
export interface ProductInput {
  /** Product name */
  name: string;

  /** Product category */
  category?: string;

  /** Product specifications/features */
  specs?: string;

  /** Product price (for context) */
  price?: number;

  /** Additional context */
  context?: string;
}

/**
 * Input data for bulk_products task
 *
 * @interface BulkProductsTaskData
 */
export interface BulkProductsTaskData {
  /** List of products to generate descriptions for */
  products: ProductInput[];

  /** Target language (ISO 639-1 code) */
  language?: string;

  /** Writing tone */
  tone?: "professional" | "casual" | "luxury" | "technical";

  /** Include SEO metadata */
  include_seo?: boolean;
}

/**
 * Single section input for design_batch task
 *
 * @interface DesignSectionInput
 */
export interface DesignSectionInput {
  /** Section name/identifier */
  name: string;

  /** Section description/purpose */
  description: string;

  /** Design style (modern, minimal, classic, bold) */
  style?: "modern" | "minimal" | "classic" | "bold";

  /** Color palette (hex values) */
  colors?: string[];

  /** Section type (hero, features, testimonials, cta, footer) */
  section_type?: "hero" | "features" | "testimonials" | "cta" | "footer" | "gallery" | "pricing";
}

/**
 * Input data for design_batch task
 *
 * @interface DesignBatchTaskData
 */
export interface DesignBatchTaskData {
  /** List of sections to generate */
  sections: DesignSectionInput[];

  /** Global theme settings */
  theme?: {
    primary_color?: string;
    secondary_color?: string;
    font_family?: string;
  };
}

/**
 * Union type for all task data types
 */
export type TaskData = BulkArticlesTaskData | BulkProductsTaskData | DesignBatchTaskData;

// ==================== RESULT TYPES ====================

/**
 * Single article result
 *
 * @interface ArticleResult
 */
export interface ArticleResult {
  /** Original topic */
  topic: string;

  /** Generated title */
  title: string;

  /** Generated HTML content */
  content: string;

  /** Tokens used for this article */
  tokens_used: number;

  /** Cost in USD */
  cost: number;

  /** Provider used */
  provider: "openai" | "gemini" | "claude";

  /** Generation status */
  status: "success" | "failed";

  /** Error message if failed */
  error?: string;

  /** SEO metadata if requested */
  seo?: {
    meta_title?: string;
    meta_description?: string;
    keywords?: string[];
  };
}

/**
 * Bulk articles result
 *
 * @interface BulkArticlesResult
 */
export interface BulkArticlesResult {
  /** Generated articles */
  articles: ArticleResult[];

  /** Total articles generated */
  total_articles: number;

  /** Total tokens used */
  total_tokens: number;

  /** Total cost in USD */
  total_cost: number;

  /** Processing time in seconds */
  processing_time_seconds: number;
}

/**
 * Single product result
 *
 * @interface ProductResult
 */
export interface ProductResult {
  /** Original product name */
  product_name: string;

  /** Generated short description */
  short_desc: string;

  /** Generated long description */
  long_desc: string;

  /** Tokens used */
  tokens_used: number;

  /** Cost in USD */
  cost: number;

  /** Provider used */
  provider: "openai" | "gemini" | "claude";

  /** Generation status */
  status: "success" | "failed";

  /** Error message if failed */
  error?: string;

  /** SEO metadata if requested */
  seo?: {
    seo_title?: string;
    seo_description?: string;
  };
}

/**
 * Bulk products result
 *
 * @interface BulkProductsResult
 */
export interface BulkProductsResult {
  /** Generated product descriptions */
  products: ProductResult[];

  /** Total products processed */
  total_products: number;

  /** Total tokens used */
  total_tokens: number;

  /** Total cost in USD */
  total_cost: number;

  /** Processing time in seconds */
  processing_time_seconds: number;
}

/**
 * Single design section result
 *
 * @interface DesignSectionResult
 */
export interface DesignSectionResult {
  /** Original section name */
  section_name: string;

  /** Elementor JSON structure */
  elementor_json: Record<string, unknown>;

  /** Tokens used */
  tokens_used: number;

  /** Cost in USD */
  cost: number;

  /** Provider used */
  provider: "openai" | "gemini" | "claude";

  /** Generation status */
  status: "success" | "failed";

  /** Error message if failed */
  error?: string;
}

/**
 * Design batch result
 *
 * @interface DesignBatchResult
 */
export interface DesignBatchResult {
  /** Generated sections */
  sections: DesignSectionResult[];

  /** Total sections processed */
  total_sections: number;

  /** Total tokens used */
  total_tokens: number;

  /** Total cost in USD */
  total_cost: number;

  /** Processing time in seconds */
  processing_time_seconds: number;
}

/**
 * Union type for all result types
 */
export type JobResult = BulkArticlesResult | BulkProductsResult | DesignBatchResult;

// ==================== MAIN JOB INTERFACE ====================

/**
 * Job document structure in Firestore job_queue collection
 *
 * @interface Job
 *
 * @example
 * ```typescript
 * const job: Job = {
 *   job_id: "job_f47ac10b-58cc-4372-a567-0e02b2c3d479",
 *   license_id: "CREATOR-2024-ABCDE-FGHIJ",
 *   task_type: "bulk_articles",
 *   task_data: {
 *     topics: ["SEO", "WordPress"],
 *     tone: "professional",
 *     language: "it"
 *   },
 *   status: "pending",
 *   attempts: 0,
 *   max_attempts: 3,
 *   created_at: Timestamp.now()
 * };
 * ```
 */
export interface Job {
  /** Unique job identifier (UUID format: job_xxx) */
  job_id: string;

  /** Reference to the license */
  license_id: string;

  /** Type of task to execute */
  task_type: JobTaskType;

  /** Task-specific input data */
  task_data: TaskData;

  /** Current job status */
  status: JobStatus;

  /** Job result (when completed) */
  result?: JobResult;

  /** Error message (when failed) */
  error_message?: string;

  /** Current retry attempt (0-3) */
  attempts: number;

  /** Maximum retry attempts */
  max_attempts: number;

  /** Progress tracking */
  progress?: JobProgress;

  /** Total tokens used (for quota tracking) */
  tokens_used?: number;

  /** Total cost in USD */
  cost_usd?: number;

  /** Job creation timestamp */
  created_at: Timestamp;

  /** Processing start timestamp */
  started_at?: Timestamp;

  /** Completion timestamp (success or failure) */
  completed_at?: Timestamp;
}

/**
 * Data for creating a new job (without auto-generated fields)
 *
 * @interface CreateJobData
 */
export interface CreateJobData {
  license_id: string;
  task_type: JobTaskType;
  task_data: TaskData;
}

/**
 * Data for updating a job
 *
 * @interface UpdateJobData
 */
export interface UpdateJobData {
  status?: JobStatus;
  result?: JobResult;
  error_message?: string;
  attempts?: number;
  progress?: JobProgress;
  tokens_used?: number;
  cost_usd?: number;
  started_at?: Timestamp;
  completed_at?: Timestamp;
}

// ==================== REQUEST/RESPONSE TYPES ====================

/**
 * Request body for POST /api/tasks/submit
 *
 * @interface SubmitTaskRequest
 */
export interface SubmitTaskRequest {
  /** Type of task to execute */
  task_type: JobTaskType;

  /** Task-specific input data */
  task_data: TaskData;
}

/**
 * Successful response from POST /api/tasks/submit
 *
 * @interface SubmitTaskResponseSuccess
 */
export interface SubmitTaskResponseSuccess {
  /** Always true for success */
  success: true;

  /** Created job ID */
  job_id: string;

  /** Initial status (always "pending") */
  status: "pending";

  /** Estimated wait time in seconds */
  estimated_wait_seconds: number;
}

/**
 * Error response from POST /api/tasks/submit
 *
 * @interface SubmitTaskResponseError
 */
export interface SubmitTaskResponseError {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code */
  code: string;
}

/**
 * Union type for submit task responses
 */
export type SubmitTaskResponse = SubmitTaskResponseSuccess | SubmitTaskResponseError;

/**
 * Successful response from GET /api/tasks/status/:id
 *
 * @interface GetStatusResponseSuccess
 */
export interface GetStatusResponseSuccess {
  /** Always true for success */
  success: true;

  /** Job ID */
  job_id: string;

  /** Current job status */
  status: JobStatus;

  /** Progress tracking (if processing) */
  progress?: JobProgress;

  /** Job result (if completed) */
  result?: JobResult;

  /** Error message (if failed) */
  error?: string;

  /** Creation timestamp (ISO string) */
  created_at: string;

  /** Start timestamp (ISO string) */
  started_at?: string;

  /** Completion timestamp (ISO string) */
  completed_at?: string;
}

/**
 * Error response from GET /api/tasks/status/:id
 *
 * @interface GetStatusResponseError
 */
export interface GetStatusResponseError {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code */
  code: string;
}

/**
 * Union type for get status responses
 */
export type GetStatusResponse = GetStatusResponseSuccess | GetStatusResponseError;

// ==================== CONSTANTS ====================

/**
 * Valid job task types for validation
 */
export const VALID_JOB_TASK_TYPES: JobTaskType[] = [
  "bulk_articles",
  "bulk_products",
  "design_batch",
];

/**
 * Maximum retry attempts
 */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Job timeout in milliseconds (9 minutes - 1 min buffer before 10 min hard limit)
 */
export const JOB_TIMEOUT_MS = 9 * 60 * 1000;

/**
 * Rate limit for task submissions per license per minute
 */
export const TASK_RATE_LIMIT_PER_MINUTE = 10;

/**
 * Maximum items per bulk job
 */
export const MAX_BULK_ITEMS = 50;

// ==================== VALIDATION HELPERS ====================

/**
 * Checks if a string is a valid job task type
 *
 * @param {string} taskType - The task type to validate
 * @returns {boolean} True if valid
 */
export function isValidJobTaskType(taskType: string): taskType is JobTaskType {
  return VALID_JOB_TASK_TYPES.includes(taskType as JobTaskType);
}

/**
 * Validates bulk_articles task data
 *
 * @param {unknown} data - The task data to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validateBulkArticlesData(
  data: unknown
): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "task_data must be an object" };
  }

  const taskData = data as Record<string, unknown>;

  if (!Array.isArray(taskData.topics)) {
    return { valid: false, error: "topics must be an array" };
  }

  if (taskData.topics.length === 0) {
    return { valid: false, error: "topics array cannot be empty" };
  }

  if (taskData.topics.length > MAX_BULK_ITEMS) {
    return { valid: false, error: `Maximum ${MAX_BULK_ITEMS} topics allowed` };
  }

  for (const topic of taskData.topics) {
    if (typeof topic !== "string" || topic.trim().length === 0) {
      return { valid: false, error: "Each topic must be a non-empty string" };
    }
  }

  if (taskData.tone && !["professional", "casual", "technical", "friendly"].includes(taskData.tone as string)) {
    return { valid: false, error: "Invalid tone value" };
  }

  if (taskData.word_count && (typeof taskData.word_count !== "number" || taskData.word_count < 100 || taskData.word_count > 5000)) {
    return { valid: false, error: "word_count must be between 100 and 5000" };
  }

  return { valid: true };
}

/**
 * Validates bulk_products task data
 *
 * @param {unknown} data - The task data to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validateBulkProductsData(
  data: unknown
): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "task_data must be an object" };
  }

  const taskData = data as Record<string, unknown>;

  if (!Array.isArray(taskData.products)) {
    return { valid: false, error: "products must be an array" };
  }

  if (taskData.products.length === 0) {
    return { valid: false, error: "products array cannot be empty" };
  }

  if (taskData.products.length > MAX_BULK_ITEMS) {
    return { valid: false, error: `Maximum ${MAX_BULK_ITEMS} products allowed` };
  }

  for (const product of taskData.products) {
    if (!product || typeof product !== "object") {
      return { valid: false, error: "Each product must be an object" };
    }

    const p = product as Record<string, unknown>;
    if (typeof p.name !== "string" || p.name.trim().length === 0) {
      return { valid: false, error: "Each product must have a non-empty name" };
    }
  }

  return { valid: true };
}

/**
 * Validates design_batch task data
 *
 * @param {unknown} data - The task data to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validateDesignBatchData(
  data: unknown
): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "task_data must be an object" };
  }

  const taskData = data as Record<string, unknown>;

  if (!Array.isArray(taskData.sections)) {
    return { valid: false, error: "sections must be an array" };
  }

  if (taskData.sections.length === 0) {
    return { valid: false, error: "sections array cannot be empty" };
  }

  if (taskData.sections.length > MAX_BULK_ITEMS) {
    return { valid: false, error: `Maximum ${MAX_BULK_ITEMS} sections allowed` };
  }

  for (const section of taskData.sections) {
    if (!section || typeof section !== "object") {
      return { valid: false, error: "Each section must be an object" };
    }

    const s = section as Record<string, unknown>;
    if (typeof s.name !== "string" || s.name.trim().length === 0) {
      return { valid: false, error: "Each section must have a non-empty name" };
    }

    if (typeof s.description !== "string" || s.description.trim().length === 0) {
      return { valid: false, error: "Each section must have a non-empty description" };
    }
  }

  return { valid: true };
}

/**
 * Validates task data based on task type
 *
 * @param {JobTaskType} taskType - The task type
 * @param {unknown} taskData - The task data to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validateTaskData(
  taskType: JobTaskType,
  taskData: unknown
): { valid: boolean; error?: string } {
  switch (taskType) {
    case "bulk_articles":
      return validateBulkArticlesData(taskData);
    case "bulk_products":
      return validateBulkProductsData(taskData);
    case "design_batch":
      return validateDesignBatchData(taskData);
    default:
      return { valid: false, error: `Unknown task type: ${taskType}` };
  }
}

/**
 * Estimates processing time based on task type and item count
 *
 * @param {JobTaskType} taskType - The task type
 * @param {number} itemCount - Number of items to process
 * @returns {number} Estimated time in seconds
 */
export function estimateProcessingTime(
  taskType: JobTaskType,
  itemCount: number
): number {
  // Average time per item in seconds based on task type
  const timePerItem: Record<JobTaskType, number> = {
    bulk_articles: 15, // ~15s per article
    bulk_products: 10, // ~10s per product
    design_batch: 20, // ~20s per design section
  };

  const baseTime = 5; // Initial setup time
  return baseTime + (timePerItem[taskType] * itemCount);
}
