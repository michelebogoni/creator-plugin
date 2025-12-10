/**
 * @fileoverview AI Provider type definitions for Creator AI Proxy
 * @module types/AIProvider
 *
 * @description
 * Defines the common interfaces that all AI provider clients must implement.
 * This ensures consistent behavior across OpenAI, Gemini, and Claude providers.
 */

/**
 * Supported AI provider names
 */
export type ProviderName = "openai" | "gemini" | "claude";

/**
 * File attachment for multimodal requests
 *
 * @interface FileAttachment
 */
export interface FileAttachment {
  /**
   * File name
   */
  name: string;

  /**
   * MIME type (e.g., "image/png", "application/pdf")
   */
  type: string;

  /**
   * File size in bytes
   */
  size: number;

  /**
   * Base64 encoded file data (may include data URI prefix)
   */
  base64: string;
}

/**
 * Options for AI generation requests
 *
 * @interface GenerateOptions
 */
export interface GenerateOptions {
  /**
   * Specific model to use (overrides provider default)
   * @example "claude-opus-4-5-20251101", "gemini-2.5-pro-preview-05-06"
   */
  model?: string;

  /**
   * Temperature for response randomness (0-1)
   * Lower values = more deterministic, higher = more creative
   * @default 0.7
   */
  temperature?: number;

  /**
   * Maximum tokens to generate in response
   * @default 4096
   */
  max_tokens?: number;

  /**
   * System prompt/instruction for the AI
   * Sets the behavior and context for the model
   */
  system_prompt?: string;

  /**
   * File attachments for multimodal requests
   * Supports images (JPEG, PNG, GIF, WebP), PDFs, and documents
   */
  files?: FileAttachment[];
}

/**
 * Response from an AI generation request
 *
 * @interface AIResponse
 */
export interface AIResponse {
  /**
   * Whether the generation was successful
   */
  success: boolean;

  /**
   * Provider that handled the request
   */
  provider: ProviderName;

  /**
   * Specific model used for generation
   */
  model: string;

  /**
   * Generated content (empty string if failed)
   */
  content: string;

  /**
   * Number of tokens in the input/prompt
   */
  tokens_input: number;

  /**
   * Number of tokens in the generated output
   */
  tokens_output: number;

  /**
   * Total tokens used (input + output)
   */
  total_tokens: number;

  /**
   * Cost in USD for this request
   */
  cost_usd: number;

  /**
   * Response latency in milliseconds
   */
  latency_ms: number;

  /**
   * Error message if success is false
   */
  error?: string;

  /**
   * Error code if success is false
   */
  error_code?: string;
}

/**
 * AI Provider error types
 */
export type AIErrorCode =
  | "RATE_LIMITED"
  | "INVALID_API_KEY"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "CONTENT_FILTERED"
  | "PROVIDER_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Custom error class for AI provider errors
 *
 * @class AIProviderError
 * @extends Error
 */
export class AIProviderError extends Error {
  /**
   * Provider that threw the error
   */
  public readonly provider: ProviderName;

  /**
   * Error code for programmatic handling
   */
  public readonly code: AIErrorCode;

  /**
   * Whether this error should trigger a retry
   */
  public readonly retryable: boolean;

  /**
   * HTTP status code if applicable
   */
  public readonly statusCode?: number;

  /**
   * Creates an AIProviderError
   *
   * @param {string} message - Human-readable error message
   * @param {ProviderName} provider - Provider that threw the error
   * @param {AIErrorCode} code - Error code
   * @param {boolean} retryable - Whether to retry on this error
   * @param {number} statusCode - HTTP status code if applicable
   */
  constructor(
    message: string,
    provider: ProviderName,
    code: AIErrorCode,
    retryable: boolean = false,
    statusCode?: number
  ) {
    super(message);
    this.name = "AIProviderError";
    this.provider = provider;
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

/**
 * Interface that all AI provider clients must implement
 *
 * @interface IAIProvider
 *
 * @description
 * This interface defines the contract for all AI provider implementations.
 * Each provider (OpenAI, Gemini, Claude) must implement these methods
 * to ensure consistent behavior across the routing system.
 *
 * @example
 * ```typescript
 * class OpenAIProvider implements IAIProvider {
 *   async generate(prompt: string, options?: GenerateOptions): Promise<AIResponse> {
 *     // Implementation
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface IAIProvider {
  /**
   * Generates content using the AI model
   *
   * @param {string} prompt - The user prompt to send to the model
   * @param {GenerateOptions} options - Optional generation parameters
   * @returns {Promise<AIResponse>} The generation response with content and metadata
   * @throws {AIProviderError} On API errors, rate limits, or timeouts
   *
   * @example
   * ```typescript
   * const response = await provider.generate(
   *   "Write a blog post about SEO",
   *   { temperature: 0.7, max_tokens: 2000 }
   * );
   * ```
   */
  generate(prompt: string, options?: GenerateOptions): Promise<AIResponse>;

  /**
   * Counts tokens in a text string
   *
   * @param {string} text - Text to count tokens for
   * @returns {Promise<number>} Estimated token count
   *
   * @description
   * Uses provider-specific tokenization when available,
   * falls back to tiktoken estimation for providers without
   * a public tokenization API.
   */
  countTokens(text: string): Promise<number>;

  /**
   * Gets the default model name for this provider
   *
   * @returns {string} Model identifier
   */
  getModel(): string;

  /**
   * Gets the provider name
   *
   * @returns {ProviderName} Provider identifier
   */
  getProviderName(): ProviderName;
}

/**
 * Pricing configuration for cost calculation
 *
 * @interface ProviderPricing
 */
export interface ProviderPricing {
  /**
   * Cost per 1000 input tokens in USD
   */
  input_cost_per_1k: number;

  /**
   * Cost per 1000 output tokens in USD
   */
  output_cost_per_1k: number;
}

/**
 * Provider pricing constants
 * Updated as of December 2025
 *
 * Active models:
 * - Claude Opus 4 (primary)
 * - Gemini Pro (fallback)
 */
export const PROVIDER_PRICING: Record<ProviderName, Record<string, ProviderPricing>> = {
  openai: {
    // OpenAI kept for future compatibility but not actively used
    "gpt-4o": {
      input_cost_per_1k: 0.005,
      output_cost_per_1k: 0.015,
    },
  },
  gemini: {
    // Gemini Pro - Primary fallback model
    "gemini-2.5-pro-preview-05-06": {
      input_cost_per_1k: 0.00125,
      output_cost_per_1k: 0.01,
    },
  },
  claude: {
    // Claude Opus 4 - Primary model
    "claude-opus-4-5-20251101": {
      input_cost_per_1k: 0.015,
      output_cost_per_1k: 0.075,
    },
  },
};

/**
 * Calculates the cost for a request based on token usage
 *
 * @param {ProviderName} provider - Provider name
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {number} Cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateCost("openai", "gpt-4o", 1000, 500);
 * // Returns: 0.0125 USD
 * ```
 */
export function calculateCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PROVIDER_PRICING[provider]?.[model];

  if (!pricing) {
    // Fallback to most expensive pricing if model not found
    return (inputTokens * 0.01 + outputTokens * 0.03) / 1000;
  }

  const inputCost = (inputTokens * pricing.input_cost_per_1k) / 1000;
  const outputCost = (outputTokens * pricing.output_cost_per_1k) / 1000;

  return inputCost + outputCost;
}

/**
 * Default generation options
 */
export const DEFAULT_GENERATE_OPTIONS: Required<Omit<GenerateOptions, "system_prompt" | "model" | "files">> = {
  temperature: 0.7,
  max_tokens: 4096,
};

/**
 * Retry configuration for providers
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries: number;

  /**
   * Base delay in ms for exponential backoff
   * @default 1000
   */
  baseDelayMs: number;

  /**
   * Maximum delay in ms
   * @default 30000
   */
  maxDelayMs: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT_MS = 30000;
