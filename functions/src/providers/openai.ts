/**
 * @fileoverview OpenAI Provider Client for Creator AI Proxy
 * @module providers/openai
 *
 * @description
 * Implements the IAIProvider interface for OpenAI's GPT models.
 * Handles API calls, token counting, cost calculation, and retry logic.
 */

import OpenAI from "openai";
import { encoding_for_model, TiktokenModel } from "tiktoken";
import {
  IAIProvider,
  AIResponse,
  GenerateOptions,
  AIProviderError,
  calculateCost,
  DEFAULT_GENERATE_OPTIONS,
  DEFAULT_RETRY_CONFIG,
  REQUEST_TIMEOUT_MS,
  RetryConfig,
} from "../types/AIProvider";
import { Logger } from "../lib/logger";

/**
 * Default model for OpenAI
 */
const DEFAULT_MODEL = "gpt-4o";

/**
 * OpenAI Provider implementation
 *
 * @class OpenAIProvider
 * @implements {IAIProvider}
 *
 * @description
 * Provides integration with OpenAI's chat completion API.
 * Features include:
 * - Exponential backoff retry on rate limits
 * - Accurate token counting using tiktoken
 * - Cost calculation based on actual usage
 * - Structured error handling
 *
 * @example
 * ```typescript
 * const provider = new OpenAIProvider(apiKey);
 * const response = await provider.generate("Write a poem about coding");
 * console.log(response.content);
 * ```
 */
export class OpenAIProvider implements IAIProvider {
  private client: OpenAI;
  private model: string;
  private retryConfig: RetryConfig;
  private logger: Logger;

  /**
   * Creates an OpenAI provider instance
   *
   * @param {string} apiKey - OpenAI API key from Firebase Secrets
   * @param {string} model - Model to use (defaults to gpt-4o)
   * @param {RetryConfig} retryConfig - Retry configuration
   *
   * @throws {AIProviderError} If API key is missing or invalid
   */
  constructor(
    apiKey: string,
    model: string = DEFAULT_MODEL,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ) {
    if (!apiKey || apiKey.trim() === "") {
      throw new AIProviderError(
        "OpenAI API key is required",
        "openai",
        "INVALID_API_KEY",
        false
      );
    }

    this.client = new OpenAI({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.model = model;
    this.retryConfig = retryConfig;
    this.logger = new Logger({ provider: "openai" });
  }

  /**
   * Generates content using OpenAI's chat completion API
   *
   * @param {string} prompt - User prompt to send to the model
   * @param {GenerateOptions} options - Optional generation parameters
   * @returns {Promise<AIResponse>} Generation response with content and metadata
   *
   * @throws {AIProviderError} On API errors, rate limits, or timeouts
   *
   * @example
   * ```typescript
   * const response = await provider.generate(
   *   "Explain quantum computing",
   *   { temperature: 0.5, max_tokens: 1000 }
   * );
   * ```
   */
  async generate(prompt: string, options?: GenerateOptions): Promise<AIResponse> {
    const startTime = Date.now();
    const model = options?.model || this.model;
    const temperature = options?.temperature ?? DEFAULT_GENERATE_OPTIONS.temperature;
    const maxTokens = options?.max_tokens ?? DEFAULT_GENERATE_OPTIONS.max_tokens;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options?.system_prompt) {
      messages.push({ role: "system", content: options.system_prompt });
    }

    messages.push({ role: "user", content: prompt });

    this.logger.debug("Starting generation", {
      model,
      temperature,
      max_tokens: maxTokens,
      prompt_length: prompt.length,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const latencyMs = Date.now() - startTime;
        const content = response.choices[0]?.message?.content || "";
        const tokensInput = response.usage?.prompt_tokens || 0;
        const tokensOutput = response.usage?.completion_tokens || 0;
        const totalTokens = tokensInput + tokensOutput;
        const costUsd = calculateCost("openai", model, tokensInput, tokensOutput);

        this.logger.info("Generation successful", {
          model,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd,
          latency_ms: latencyMs,
        });

        return {
          success: true,
          provider: "openai",
          model,
          content,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          total_tokens: totalTokens,
          cost_usd: costUsd,
          latency_ms: latencyMs,
        };
      } catch (error) {
        lastError = error as Error;
        const { shouldRetry, errorCode, statusCode } = this.parseError(error);

        if (!shouldRetry || attempt === this.retryConfig.maxRetries) {
          this.logger.error("Generation failed", {
            model,
            attempt,
            error_code: errorCode,
            error_message: lastError.message,
          });

          return {
            success: false,
            provider: "openai",
            model,
            content: "",
            tokens_input: 0,
            tokens_output: 0,
            total_tokens: 0,
            cost_usd: 0,
            latency_ms: Date.now() - startTime,
            error: lastError.message,
            error_code: errorCode,
          };
        }

        // Calculate backoff delay
        const delay = Math.min(
          this.retryConfig.baseDelayMs * Math.pow(2, attempt),
          this.retryConfig.maxDelayMs
        );

        this.logger.warn("Retrying after error", {
          model,
          attempt: attempt + 1,
          max_retries: this.retryConfig.maxRetries,
          delay_ms: delay,
          error_code: errorCode,
          status_code: statusCode,
        });

        await this.sleep(delay);
      }
    }

    // Should not reach here, but handle just in case
    return {
      success: false,
      provider: "openai",
      model,
      content: "",
      tokens_input: 0,
      tokens_output: 0,
      total_tokens: 0,
      cost_usd: 0,
      latency_ms: Date.now() - startTime,
      error: lastError?.message || "Unknown error",
      error_code: "UNKNOWN_ERROR",
    };
  }

  /**
   * Counts tokens in a text string using tiktoken
   *
   * @param {string} text - Text to count tokens for
   * @returns {Promise<number>} Token count
   *
   * @description
   * Uses OpenAI's tiktoken library for accurate token counting.
   * Falls back to character-based estimation if tokenizer fails.
   */
  async countTokens(text: string): Promise<number> {
    try {
      // Map model to tiktoken model name
      const tiktokenModel = this.getTiktokenModel(this.model);
      const enc = encoding_for_model(tiktokenModel);
      const tokens = enc.encode(text);
      enc.free();
      return tokens.length;
    } catch {
      // Fallback: estimate ~4 characters per token
      this.logger.warn("Tiktoken encoding failed, using estimation", {
        model: this.model,
      });
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Gets the default model name
   *
   * @returns {string} Model identifier
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Gets the provider name
   *
   * @returns {"openai"} Provider identifier
   */
  getProviderName(): "openai" {
    return "openai";
  }

  /**
   * Maps OpenAI model names to tiktoken model names
   *
   * @param {string} model - OpenAI model name
   * @returns {TiktokenModel} Tiktoken model name
   * @private
   */
  private getTiktokenModel(model: string): TiktokenModel {
    // GPT-4o and GPT-4o-mini use the same tokenizer as GPT-4
    if (model.startsWith("gpt-4o")) {
      return "gpt-4o";
    }
    if (model.startsWith("gpt-4")) {
      return "gpt-4";
    }
    if (model.startsWith("gpt-3.5")) {
      return "gpt-3.5-turbo";
    }
    // Default to gpt-4o for unknown models
    return "gpt-4o";
  }

  /**
   * Parses OpenAI API errors and determines retry strategy
   *
   * @param {unknown} error - Error from OpenAI API
   * @returns {Object} Error analysis with retry recommendation
   * @private
   */
  private parseError(error: unknown): {
    shouldRetry: boolean;
    errorCode: string;
    statusCode?: number;
  } {
    // Check for OpenAI API error (also handles mocked errors with status property)
    const apiError = error as { status?: number; message?: string };
    const statusCode = error instanceof OpenAI.APIError
      ? error.status
      : apiError.status;

    if (statusCode !== undefined) {
      // Rate limited - retry with backoff
      if (statusCode === 429) {
        return { shouldRetry: true, errorCode: "RATE_LIMITED", statusCode };
      }

      // Authentication error - do not retry
      if (statusCode === 401) {
        return { shouldRetry: false, errorCode: "INVALID_API_KEY", statusCode };
      }

      // Server errors - retry
      if (statusCode >= 500) {
        return { shouldRetry: true, errorCode: "PROVIDER_ERROR", statusCode };
      }

      // Bad request - do not retry
      if (statusCode === 400) {
        return { shouldRetry: false, errorCode: "INVALID_REQUEST", statusCode };
      }

      // Content filtered - do not retry
      if (statusCode === 403) {
        return { shouldRetry: false, errorCode: "CONTENT_FILTERED", statusCode };
      }

      return { shouldRetry: false, errorCode: "PROVIDER_ERROR", statusCode };
    }

    // Timeout error
    if (error instanceof Error && error.message.includes("timeout")) {
      return { shouldRetry: true, errorCode: "TIMEOUT" };
    }

    // Network error
    if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
      return { shouldRetry: true, errorCode: "NETWORK_ERROR" };
    }

    return { shouldRetry: false, errorCode: "UNKNOWN_ERROR" };
  }

  /**
   * Sleep utility for retry backoff
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
