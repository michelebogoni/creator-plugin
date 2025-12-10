/**
 * @fileoverview Anthropic Claude Provider Client for Creator AI Proxy
 * @module providers/claude
 *
 * @description
 * Implements the IAIProvider interface for Anthropic's Claude models.
 * Handles API calls, token counting, cost calculation, and retry logic.
 */

import Anthropic from "@anthropic-ai/sdk";
import { encoding_for_model } from "tiktoken";
import {
  IAIProvider,
  AIResponse,
  GenerateOptions,
  AIProviderError,
  FileAttachment,
  calculateCost,
  DEFAULT_GENERATE_OPTIONS,
  DEFAULT_RETRY_CONFIG,
  REQUEST_TIMEOUT_MS,
  RetryConfig,
} from "../types/AIProvider";
import { Logger } from "../lib/logger";

/**
 * Default model for Claude - Opus 4 (highest quality)
 */
const DEFAULT_MODEL = "claude-opus-4-5-20251101";

/**
 * Claude Provider implementation
 *
 * @class ClaudeProvider
 * @implements {IAIProvider}
 *
 * @description
 * Provides integration with Anthropic's Claude API.
 * Features include:
 * - Exponential backoff retry on rate limits
 * - Token counting using tiktoken (cl100k_base encoding)
 * - Accurate cost calculation from API response usage
 * - Structured error handling
 *
 * @example
 * ```typescript
 * const provider = new ClaudeProvider(apiKey);
 * const response = await provider.generate("Write a poem about coding");
 * console.log(response.content);
 * ```
 */
export class ClaudeProvider implements IAIProvider {
  private client: Anthropic;
  private model: string;
  private retryConfig: RetryConfig;
  private logger: Logger;

  /**
   * Creates a Claude provider instance
   *
   * @param {string} apiKey - Anthropic API key from Firebase Secrets
   * @param {string} model - Model to use (defaults to claude-opus-4-5-20251101)
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
        "Claude API key is required",
        "claude",
        "INVALID_API_KEY",
        false
      );
    }

    this.client = new Anthropic({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.model = model;
    this.retryConfig = retryConfig;
    this.logger = new Logger({ provider: "claude" });
  }

  /**
   * Generates content using Claude's messages API
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

    this.logger.debug("Starting generation", {
      model,
      temperature,
      max_tokens: maxTokens,
      prompt_length: prompt.length,
      files_count: options?.files?.length || 0,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Build message content with text and optional file attachments
        const messageContent = this.buildMessageContent(prompt, options?.files);

        const response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system: options?.system_prompt,
          messages: [{ role: "user", content: messageContent }],
        });

        const latencyMs = Date.now() - startTime;

        // Extract text content from response
        let content = "";
        for (const block of response.content) {
          if (block.type === "text") {
            content += block.text;
          }
        }

        // Get token counts from usage
        const tokensInput = response.usage.input_tokens;
        const tokensOutput = response.usage.output_tokens;
        const totalTokens = tokensInput + tokensOutput;
        const costUsd = calculateCost("claude", model, tokensInput, tokensOutput);

        this.logger.info("Generation successful", {
          model,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd,
          latency_ms: latencyMs,
          stop_reason: response.stop_reason,
        });

        return {
          success: true,
          provider: "claude",
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
            provider: "claude",
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
      provider: "claude",
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
   * Builds message content array for multimodal requests
   *
   * @param {string} prompt - Text prompt
   * @param {FileAttachment[]} files - Optional file attachments
   * @returns {string | Array} Content for message - string if no files, array if multimodal
   * @private
   */
  private buildMessageContent(
    prompt: string,
    files?: FileAttachment[]
  ): string | Anthropic.MessageCreateParams["messages"][0]["content"] {
    // If no files, return simple string
    if (!files || files.length === 0) {
      return prompt;
    }

    // Build content blocks array for multimodal
    const contentBlocks: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    // Add file blocks first (Claude processes them in order)
    for (const file of files) {
      // Only process supported image types for Claude
      const supportedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

      if (!supportedTypes.includes(file.type)) {
        this.logger.warn("Unsupported file type for Claude, skipping", {
          file_name: file.name,
          file_type: file.type,
        });
        continue;
      }

      // Remove data URI prefix if present (e.g., "data:image/png;base64,")
      let base64Data = file.base64;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }

      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64Data,
        },
      });

      this.logger.debug("Added file to Claude request", {
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
      });
    }

    // Add text prompt last
    contentBlocks.push({
      type: "text",
      text: prompt,
    });

    return contentBlocks;
  }

  /**
   * Counts tokens in a text string using tiktoken
   *
   * @param {string} text - Text to count tokens for
   * @returns {Promise<number>} Estimated token count
   *
   * @description
   * Uses tiktoken with cl100k_base encoding (same tokenizer family as Claude).
   * This provides a reasonable estimate for pre-request token counting.
   * Actual token counts come from the API response usage data.
   */
  async countTokens(text: string): Promise<number> {
    try {
      // Claude uses a similar tokenizer to GPT-4 (cl100k_base)
      const enc = encoding_for_model("gpt-4o");
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
   * @returns {"claude"} Provider identifier
   */
  getProviderName(): "claude" {
    return "claude";
  }

  /**
   * Parses Anthropic API errors and determines retry strategy
   *
   * @param {unknown} error - Error from Anthropic API
   * @returns {Object} Error analysis with retry recommendation
   * @private
   */
  private parseError(error: unknown): {
    shouldRetry: boolean;
    errorCode: string;
    statusCode?: number;
  } {
    // Check for Anthropic API error (also handles mocked errors with status property)
    const apiError = error as { status?: number; message?: string };
    const statusCode = error instanceof Anthropic.APIError
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

      // Overloaded - retry
      if (statusCode === 529) {
        return { shouldRetry: true, errorCode: "PROVIDER_ERROR", statusCode };
      }

      // Server errors - retry
      if (statusCode >= 500) {
        return { shouldRetry: true, errorCode: "PROVIDER_ERROR", statusCode };
      }

      // Bad request - do not retry
      if (statusCode === 400) {
        return { shouldRetry: false, errorCode: "INVALID_REQUEST", statusCode };
      }

      return { shouldRetry: false, errorCode: "PROVIDER_ERROR", statusCode };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Timeout error
    if (errorMessage.includes("timeout")) {
      return { shouldRetry: true, errorCode: "TIMEOUT" };
    }

    // Network error
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("network")) {
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
