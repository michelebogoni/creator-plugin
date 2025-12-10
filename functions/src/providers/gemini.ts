/**
 * @fileoverview Google Gemini Provider Client for Creator AI Proxy
 * @module providers/gemini
 *
 * @description
 * Implements the IAIProvider interface for Google's Gemini models.
 * Handles API calls, token counting, cost calculation, and retry logic.
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import {
  IAIProvider,
  AIResponse,
  GenerateOptions,
  AIProviderError,
  FileAttachment,
  calculateCost,
  DEFAULT_GENERATE_OPTIONS,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from "../types/AIProvider";
import { Logger } from "../lib/logger";

/**
 * Default model for Gemini - Pro (fallback provider)
 */
const DEFAULT_MODEL = "gemini-2.5-pro-preview-05-06";

/**
 * Safety settings to allow most content (business use case)
 */
const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

/**
 * Gemini Provider implementation
 *
 * @class GeminiProvider
 * @implements {IAIProvider}
 *
 * @description
 * Provides integration with Google's Gemini API.
 * Features include:
 * - Exponential backoff retry on rate limits
 * - Native token counting using Gemini's countTokens API
 * - Cost calculation based on actual usage
 * - Structured error handling
 *
 * @example
 * ```typescript
 * const provider = new GeminiProvider(apiKey);
 * const response = await provider.generate("Write a poem about coding");
 * console.log(response.content);
 * ```
 */
export class GeminiProvider implements IAIProvider {
  private client: GoogleGenerativeAI;
  private model: string;
  private retryConfig: RetryConfig;
  private logger: Logger;

  /**
   * Creates a Gemini provider instance
   *
   * @param {string} apiKey - Gemini API key from Firebase Secrets
   * @param {string} model - Model to use (defaults to gemini-2.5-pro-preview-05-06)
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
        "Gemini API key is required",
        "gemini",
        "INVALID_API_KEY",
        false
      );
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
    this.retryConfig = retryConfig;
    this.logger = new Logger({ provider: "gemini" });
  }

  /**
   * Gets a configured generative model instance
   *
   * @param {string} modelName - Model name to use
   * @param {GenerationConfig} generationConfig - Generation configuration
   * @param {string} systemInstruction - Optional system instruction
   * @returns {GenerativeModel} Configured model instance
   * @private
   */
  private getGenerativeModel(
    modelName: string,
    generationConfig: GenerationConfig,
    systemInstruction?: string
  ): GenerativeModel {
    return this.client.getGenerativeModel({
      model: modelName,
      generationConfig,
      safetySettings: SAFETY_SETTINGS,
      systemInstruction,
    });
  }

  /**
   * Generates content using Gemini's API
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
    const modelName = options?.model || this.model;
    const temperature = options?.temperature ?? DEFAULT_GENERATE_OPTIONS.temperature;
    const maxTokens = options?.max_tokens ?? DEFAULT_GENERATE_OPTIONS.max_tokens;

    const generationConfig: GenerationConfig = {
      temperature,
      maxOutputTokens: maxTokens,
    };

    this.logger.debug("Starting generation", {
      model: modelName,
      temperature,
      max_tokens: maxTokens,
      prompt_length: prompt.length,
      files_count: options?.files?.length || 0,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const model = this.getGenerativeModel(
          modelName,
          generationConfig,
          options?.system_prompt
        );

        // Build content parts - text first, then files
        const contentParts = this.buildContentParts(prompt, options?.files);
        const result = await model.generateContent(contentParts);
        const response = result.response;
        const content = response.text();

        const latencyMs = Date.now() - startTime;

        // Get token counts from usage metadata
        const usageMetadata = response.usageMetadata;
        const tokensInput = usageMetadata?.promptTokenCount || 0;
        const tokensOutput = usageMetadata?.candidatesTokenCount || 0;
        const totalTokens = tokensInput + tokensOutput;
        const costUsd = calculateCost("gemini", modelName, tokensInput, tokensOutput);

        this.logger.info("Generation successful", {
          model: modelName,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd,
          latency_ms: latencyMs,
        });

        return {
          success: true,
          provider: "gemini",
          model: modelName,
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
            model: modelName,
            attempt,
            error_code: errorCode,
            error_message: lastError.message,
          });

          return {
            success: false,
            provider: "gemini",
            model: modelName,
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
          model: modelName,
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
      provider: "gemini",
      model: modelName,
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
   * Builds content parts array for multimodal requests
   *
   * @param {string} prompt - Text prompt
   * @param {FileAttachment[]} files - Optional file attachments
   * @returns {Array} Content parts for generateContent
   * @private
   */
  private buildContentParts(
    prompt: string,
    files?: FileAttachment[]
  ): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
    // Start with text part
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    // Add file parts if present
    if (files && files.length > 0) {
      for (const file of files) {
        // Only process supported image types for Gemini
        const supportedTypes = [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "application/pdf",
        ];

        if (!supportedTypes.includes(file.type)) {
          this.logger.warn("Unsupported file type for Gemini, skipping", {
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

        parts.push({
          inlineData: {
            mimeType: file.type,
            data: base64Data,
          },
        });

        this.logger.debug("Added file to Gemini request", {
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        });
      }
    }

    return parts;
  }

  /**
   * Counts tokens in a text string using Gemini's native API
   *
   * @param {string} text - Text to count tokens for
   * @returns {Promise<number>} Token count
   *
   * @description
   * Uses Gemini's countTokens API for accurate token counting.
   * Falls back to character-based estimation if API call fails.
   */
  async countTokens(text: string): Promise<number> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      const result = await model.countTokens(text);
      return result.totalTokens;
    } catch {
      // Fallback: estimate ~4 characters per token
      this.logger.warn("Gemini countTokens failed, using estimation", {
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
   * @returns {"gemini"} Provider identifier
   */
  getProviderName(): "gemini" {
    return "gemini";
  }

  /**
   * Parses Gemini API errors and determines retry strategy
   *
   * @param {unknown} error - Error from Gemini API
   * @returns {Object} Error analysis with retry recommendation
   * @private
   */
  private parseError(error: unknown): {
    shouldRetry: boolean;
    errorCode: string;
    statusCode?: number;
  } {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Rate limited
    if (
      errorMessage.includes("429") ||
      errorMessage.includes("RESOURCE_EXHAUSTED") ||
      errorMessage.includes("quota")
    ) {
      return { shouldRetry: true, errorCode: "RATE_LIMITED", statusCode: 429 };
    }

    // Authentication error
    if (
      errorMessage.includes("401") ||
      errorMessage.includes("UNAUTHENTICATED") ||
      errorMessage.includes("API key")
    ) {
      return { shouldRetry: false, errorCode: "INVALID_API_KEY", statusCode: 401 };
    }

    // Server errors
    if (
      errorMessage.includes("500") ||
      errorMessage.includes("502") ||
      errorMessage.includes("503") ||
      errorMessage.includes("INTERNAL")
    ) {
      return { shouldRetry: true, errorCode: "PROVIDER_ERROR", statusCode: 500 };
    }

    // Bad request
    if (errorMessage.includes("400") || errorMessage.includes("INVALID_ARGUMENT")) {
      return { shouldRetry: false, errorCode: "INVALID_REQUEST", statusCode: 400 };
    }

    // Content filtered (safety)
    if (
      errorMessage.includes("SAFETY") ||
      errorMessage.includes("blocked") ||
      errorMessage.includes("HARM")
    ) {
      return { shouldRetry: false, errorCode: "CONTENT_FILTERED", statusCode: 403 };
    }

    // Timeout
    if (errorMessage.includes("timeout") || errorMessage.includes("DEADLINE_EXCEEDED")) {
      return { shouldRetry: true, errorCode: "TIMEOUT" };
    }

    // Network error
    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("network") ||
      errorMessage.includes("UNAVAILABLE")
    ) {
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
