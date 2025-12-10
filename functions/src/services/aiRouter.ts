/**
 * @fileoverview AI Router Service for intelligent provider routing
 * @module services/aiRouter
 *
 * @description
 * Implements smart routing logic that selects the optimal AI provider
 * based on task type, with automatic fallback on failures.
 */

import { OpenAIProvider } from "../providers/openai";
import { GeminiProvider } from "../providers/gemini";
import { ClaudeProvider } from "../providers/claude";
import {
  IAIProvider,
  GenerateOptions,
  ProviderName,
} from "../types/AIProvider";
import {
  TaskType,
  DEFAULT_ROUTING_MATRIX,
  ProviderRouteConfig,
} from "../types/Route";
import { Logger } from "../lib/logger";

/**
 * Result from the AI router
 */
export interface AIRouterResult {
  /** Whether generation succeeded */
  success: boolean;

  /** Generated content (empty if failed) */
  content: string;

  /** Provider that handled the request */
  provider: ProviderName;

  /** Model used */
  model: string;

  /** Input tokens consumed */
  tokens_input: number;

  /** Output tokens generated */
  tokens_output: number;

  /** Total tokens (input + output) */
  total_tokens: number;

  /** Cost in USD */
  cost_usd: number;

  /** Response latency in milliseconds */
  latency_ms: number;

  /** Error message if failed */
  error?: string;

  /** Error code if failed */
  error_code?: string;

  /** Which providers were attempted */
  providers_attempted: ProviderName[];
}

/**
 * Provider API keys configuration
 */
export interface ProviderKeys {
  openai: string;
  gemini: string;
  claude: string;
}

/**
 * AI Router class for intelligent provider routing
 *
 * @class AIRouter
 *
 * @description
 * Routes AI requests to the optimal provider based on task type,
 * with automatic fallback when primary providers fail.
 *
 * @example
 * ```typescript
 * const router = new AIRouter({
 *   openai: openaiApiKey.value(),
 *   gemini: geminiApiKey.value(),
 *   claude: claudeApiKey.value(),
 * }, logger);
 *
 * const result = await router.route("TEXT_GEN", "Write an article about AI");
 * ```
 */
export class AIRouter {
  private providers: Map<string, IAIProvider> = new Map();
  private logger: Logger;
  private keys: ProviderKeys;

  /**
   * Creates an AI Router instance
   *
   * @param {ProviderKeys} keys - API keys for each provider
   * @param {Logger} logger - Logger instance
   */
  constructor(keys: ProviderKeys, logger: Logger) {
    this.keys = keys;
    this.logger = logger.child({ service: "aiRouter" });
  }

  /**
   * Gets or creates a provider instance
   *
   * @param {ProviderRouteConfig} config - Provider configuration
   * @returns {IAIProvider} Provider instance
   * @private
   */
  private getProvider(config: ProviderRouteConfig): IAIProvider {
    const cacheKey = `${config.provider}:${config.model}`;

    if (!this.providers.has(cacheKey)) {
      const provider = this.createProvider(config);
      this.providers.set(cacheKey, provider);
    }

    return this.providers.get(cacheKey)!;
  }

  /**
   * Creates a new provider instance
   *
   * @param {ProviderRouteConfig} config - Provider configuration
   * @returns {IAIProvider} New provider instance
   * @private
   */
  private createProvider(config: ProviderRouteConfig): IAIProvider {
    switch (config.provider) {
      case "openai":
        return new OpenAIProvider(this.keys.openai, config.model);
      case "gemini":
        return new GeminiProvider(this.keys.gemini, config.model);
      case "claude":
        return new ClaudeProvider(this.keys.claude, config.model);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  /**
   * Routes an AI request to the appropriate provider with fallback
   *
   * @param {TaskType} taskType - Type of task to perform
   * @param {string} prompt - The prompt to send
   * @param {GenerateOptions} options - Optional generation parameters
   * @returns {Promise<AIRouterResult>} Result with content and metadata
   *
   * @description
   * Tries providers in order: primary → fallback1 → fallback2.
   * Returns 503 error if all providers fail.
   *
   * @example
   * ```typescript
   * const result = await router.route(
   *   "CODE_GEN",
   *   "Write a function to sort an array",
   *   { temperature: 0.3 }
   * );
   * ```
   */
  async route(
    taskType: TaskType,
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIRouterResult> {
    const routeConfig = DEFAULT_ROUTING_MATRIX[taskType];
    const providersToTry: ProviderRouteConfig[] = [
      routeConfig.primary,
      routeConfig.fallback1,
      routeConfig.fallback2,
    ];

    const providersAttempted: ProviderName[] = [];
    let lastError: string | undefined;
    let lastErrorCode: string | undefined;

    this.logger.info("Starting route request", {
      task_type: taskType,
      prompt_length: prompt.length,
      providers_chain: providersToTry.map((p) => `${p.provider}:${p.model}`),
    });

    for (const providerConfig of providersToTry) {
      providersAttempted.push(providerConfig.provider);

      this.logger.debug("Trying provider", {
        provider: providerConfig.provider,
        model: providerConfig.model,
        attempt: providersAttempted.length,
      });

      try {
        const provider = this.getProvider(providerConfig);
        const response = await provider.generate(prompt, options);

        if (response.success) {
          this.logger.info("Route request successful", {
            task_type: taskType,
            provider: response.provider,
            model: response.model,
            tokens_total: response.total_tokens,
            cost_usd: response.cost_usd,
            latency_ms: response.latency_ms,
            attempts: providersAttempted.length,
          });

          return {
            success: true,
            content: response.content,
            provider: response.provider,
            model: response.model,
            tokens_input: response.tokens_input,
            tokens_output: response.tokens_output,
            total_tokens: response.total_tokens,
            cost_usd: response.cost_usd,
            latency_ms: response.latency_ms,
            providers_attempted: providersAttempted,
          };
        }

        // Provider returned success: false
        lastError = response.error || "Unknown error";
        lastErrorCode = response.error_code || "UNKNOWN_ERROR";

        this.logger.warn("Provider failed, trying fallback", {
          provider: providerConfig.provider,
          model: providerConfig.model,
          error: lastError,
          error_code: lastErrorCode,
          remaining_providers: providersToTry.length - providersAttempted.length,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        lastErrorCode = "PROVIDER_ERROR";

        this.logger.warn("Provider threw exception, trying fallback", {
          provider: providerConfig.provider,
          model: providerConfig.model,
          error: lastError,
          remaining_providers: providersToTry.length - providersAttempted.length,
        });
      }
    }

    // All providers failed
    this.logger.error("All providers failed", {
      task_type: taskType,
      providers_attempted: providersAttempted,
      last_error: lastError,
    });

    return {
      success: false,
      content: "",
      provider: providersAttempted[providersAttempted.length - 1],
      model: "",
      tokens_input: 0,
      tokens_output: 0,
      total_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
      error: lastError || "All providers failed",
      error_code: "ALL_PROVIDERS_FAILED",
      providers_attempted: providersAttempted,
    };
  }

  /**
   * Gets the routing configuration for a task type
   *
   * @param {TaskType} taskType - The task type
   * @returns {ProviderRouteConfig[]} Array of provider configs in priority order
   */
  getRouteConfig(taskType: TaskType): ProviderRouteConfig[] {
    const config = DEFAULT_ROUTING_MATRIX[taskType];
    return [config.primary, config.fallback1, config.fallback2];
  }
}

/**
 * Sanitizes prompt by removing potentially dangerous content
 *
 * @param {string} prompt - Raw prompt
 * @returns {string} Sanitized prompt
 *
 * @description
 * Removes script tags and other potentially dangerous HTML.
 * Does NOT escape HTML entities as AI providers handle this.
 */
export function sanitizePrompt(prompt: string): string {
  // Remove script tags and their content
  let sanitized = prompt.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove other potentially dangerous tags
  sanitized = sanitized.replace(/<(iframe|object|embed|form)[^>]*>.*?<\/\1>/gi, "");

  // Remove event handlers
  sanitized = sanitized.replace(/\son\w+\s*=/gi, " data-removed=");

  return sanitized.trim();
}

/**
 * Validates a prompt for length and content
 *
 * @param {string} prompt - The prompt to validate
 * @param {number} maxLength - Maximum allowed length (default 10000)
 * @returns {{ valid: boolean; error?: string }} Validation result
 */
export function validatePrompt(
  prompt: string,
  maxLength: number = 10000
): { valid: boolean; error?: string } {
  if (!prompt || typeof prompt !== "string") {
    return { valid: false, error: "Prompt is required and must be a string" };
  }

  const trimmed = prompt.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: "Prompt cannot be empty" };
  }

  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Prompt exceeds maximum length of ${maxLength} characters`,
    };
  }

  return { valid: true };
}
