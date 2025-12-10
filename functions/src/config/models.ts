/**
 * @fileoverview AI Models Configuration - Single Source of Truth
 * @module config/models
 *
 * @description
 * This file is the ONLY source of truth for AI model configurations in Creator.
 * All other files MUST import from here. DO NOT define model IDs elsewhere.
 *
 * Creator supports exactly 2 AI providers:
 * - Gemini (Google)
 * - Claude (Anthropic)
 *
 * Last updated: December 2025
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported AI providers
 */
export type AIProvider = "gemini" | "claude";

/**
 * Model pricing per 1k tokens (USD)
 */
export interface ModelPricing {
  /** Cost per 1k input tokens */
  input: number;
  /** Cost per 1k output tokens */
  output: number;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Official API model identifier */
  id: string;
  /** Pricing per 1k tokens */
  pricing: ModelPricing;
}

// ============================================================================
// AI_MODELS - SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * AI_MODELS - The only source of truth for AI models in Creator
 *
 * @description
 * Creator uses exactly 2 models:
 * - Gemini 2.5 Pro for Google AI
 * - Claude Opus 4.5 for Anthropic AI
 *
 * Pricing is in USD per 1k tokens.
 *
 * @example
 * ```typescript
 * import { AI_MODELS } from '../config/models';
 *
 * const geminiId = AI_MODELS.gemini.id;
 * const claudePricing = AI_MODELS.claude.pricing;
 * ```
 */
export const AI_MODELS: Record<AIProvider, ModelConfig> = {
  gemini: {
    id: "gemini-2.5-pro",
    pricing: {
      input: 0.00125,
      output: 0.005,
    },
  },
  claude: {
    id: "claude-opus-4-5-20251101",
    pricing: {
      input: 0.015,
      output: 0.075,
    },
  },
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a model ID is valid (one of the supported models)
 *
 * @param {string} id - The model ID to validate
 * @returns {boolean} True if the model ID matches one of the supported models
 *
 * @example
 * ```typescript
 * isValidModel("gemini-2.5-pro"); // true
 * isValidModel("claude-opus-4-5-20251101"); // true
 * isValidModel("gpt-4"); // false
 * ```
 */
export function isValidModel(id: string): boolean {
  return id === AI_MODELS.gemini.id || id === AI_MODELS.claude.id;
}

/**
 * Gets the pricing for a model by its ID
 *
 * @param {string} id - The model ID
 * @returns {ModelPricing | null} Pricing object or null if model not found
 *
 * @example
 * ```typescript
 * const pricing = getModelPricing("claude-opus-4-5-20251101");
 * // { input: 0.015, output: 0.075 }
 * ```
 */
export function getModelPricing(id: string): ModelPricing | null {
  if (id === AI_MODELS.gemini.id) {
    return AI_MODELS.gemini.pricing;
  }
  if (id === AI_MODELS.claude.id) {
    return AI_MODELS.claude.pricing;
  }
  return null;
}

/**
 * Gets the primary model ID for a provider
 *
 * @param {AIProvider} provider - The provider name ("gemini" or "claude")
 * @returns {string} The model ID for that provider
 *
 * @example
 * ```typescript
 * getPrimaryModel("gemini"); // "gemini-2.5-pro"
 * getPrimaryModel("claude"); // "claude-opus-4-5-20251101"
 * ```
 */
export function getPrimaryModel(provider: AIProvider): string {
  return AI_MODELS[provider].id;
}

/**
 * MODEL_IDS - Map from provider to model ID
 *
 * @description
 * Quick lookup to get model ID from provider name.
 *
 * @example
 * ```typescript
 * MODEL_IDS["gemini"]; // "gemini-2.5-pro"
 * MODEL_IDS["claude"]; // "claude-opus-4-5-20251101"
 * ```
 */
export const MODEL_IDS: Record<AIProvider, string> = {
  gemini: AI_MODELS.gemini.id,
  claude: AI_MODELS.claude.id,
};

/**
 * Type guard to check if a string is a valid AI provider
 *
 * @param {string} provider - The provider to validate
 * @returns {boolean} True if provider is "gemini" or "claude"
 *
 * @example
 * ```typescript
 * isValidProvider("gemini"); // true
 * isValidProvider("gpt"); // false
 * ```
 */
export function isValidProvider(provider: string): provider is AIProvider {
  return provider === "gemini" || provider === "claude";
}
