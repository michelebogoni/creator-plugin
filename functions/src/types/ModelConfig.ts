/**
 * @fileoverview Model Request/Response Types for Creator AI Proxy
 * @module types/ModelConfig
 *
 * @description
 * Type definitions for AI model requests and responses.
 * Model configurations are imported from config/models.ts (single source of truth).
 */

import { AIProvider, AI_MODELS, isValidModel, isValidProvider, getPrimaryModel, MODEL_IDS } from "../config/models";

// ============================================================================
// RE-EXPORTS FROM CONFIG/MODELS
// ============================================================================

/**
 * Available AI models (re-exported for backwards compatibility)
 */
export type AIModel = AIProvider;

/**
 * Re-export model utilities
 */
export { AI_MODELS, isValidModel, isValidProvider, getPrimaryModel, MODEL_IDS };

// ============================================================================
// MODEL UTILITIES
// ============================================================================

/**
 * Get fallback model when primary fails
 */
export function getFallbackModel(model: AIModel): AIModel {
  return model === "gemini" ? "claude" : "gemini";
}

// ============================================================================
// REQUEST/RESPONSE INTERFACES
// ============================================================================

/**
 * File attachment for multimodal requests
 */
export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  base64: string;
}

/**
 * Model request interface
 */
export interface ModelRequest {
  /** Selected model */
  model: AIModel;

  /** User prompt */
  prompt: string;

  /** Site context from WordPress */
  context?: Record<string, unknown>;

  /** System prompt override */
  system_prompt?: string;

  /** Chat ID for session tracking */
  chat_id?: string;

  /** Temperature (0-1) */
  temperature?: number;

  /** Max tokens */
  max_tokens?: number;

  /** File attachments for multimodal */
  files?: FileAttachment[];
}

/**
 * Model response interface
 */
export interface ModelResponse {
  /** Overall success */
  success: boolean;

  /** Generated content */
  content: string;

  /** Model used */
  model: AIModel;

  /** Model ID used */
  model_id: string;

  /** Whether fallback was used */
  used_fallback: boolean;

  /** Tokens used */
  tokens_input: number;
  tokens_output: number;
  total_tokens: number;

  /** Cost in USD */
  cost_usd: number;

  /** Latency in ms */
  latency_ms: number;

  /** Error if failed */
  error?: string;
  error_code?: string;
}
