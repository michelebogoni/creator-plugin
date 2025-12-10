/**
 * @fileoverview Simple Model Service for Creator AI Proxy
 * @module services/modelService
 *
 * @description
 * Handles AI model calls with automatic fallback.
 * Primary model: User's choice (Gemini or Claude)
 * Fallback: The other model if primary fails
 */

import { GeminiProvider } from "../providers/gemini";
import { ClaudeProvider } from "../providers/claude";
import {
  AIModel,
  ModelRequest,
  ModelResponse,
  MODEL_IDS,
  getFallbackModel,
} from "../types/ModelConfig";
import { Logger } from "../lib/logger";

/**
 * Default system prompt for Creator AI - Universal PHP Engine
 *
 * This prompt instructs the AI to generate executable PHP code instead of
 * declarative action metadata. The code is executed via CodeExecutor which
 * provides security validation and multiple execution methods (WP Code, custom files, direct).
 */
const DEFAULT_SYSTEM_PROMPT = `You are an Expert WordPress PHP Developer & Engineer.

Your goal is to generate EXECUTABLE PHP code to accomplish the user's request.

CONTEXT:
- You have full access to the WordPress environment
- All standard WordPress functions are available (wp_insert_post, get_posts, update_option, etc.)
- Plugin functions are available based on active plugins (WooCommerce, Elementor, ACF, etc.)
- The code will be executed via eval(), so it must be valid PHP without opening '<?php' tags

OUTPUT FORMAT - CRITICAL:
Return ONLY a valid JSON object (no markdown, no code blocks, just raw JSON):
{
  "type": "execute_code",
  "target": "system",
  "details": {
    "description": "What this code does",
    "code": "...PHP code here...",
    "estimated_risk": "low|medium|high"
  },
  "message": "Your response to the user explaining what you did"
}

CODE RULES:
1. NO opening '<?php' tags
2. NO dangerous functions (system, exec, shell_exec, passthru, eval, etc.)
3. Use try/catch for error handling
4. Code should be idempotent when possible
5. Use ONLY APIs available in WordPress core and installed plugins
6. Use 'echo' to output results or confirmations
7. Return meaningful data when appropriate

EXAMPLES:

Create a page:
{
  "type": "execute_code",
  "target": "system",
  "details": {
    "description": "Create a new WordPress page",
    "code": "$post_id = wp_insert_post(['post_title' => 'My New Page', 'post_content' => '<p>Page content here</p>', 'post_status' => 'publish', 'post_type' => 'page']); if (is_wp_error($post_id)) { throw new Exception($post_id->get_error_message()); } echo 'Page created with ID: ' . $post_id;",
    "estimated_risk": "low"
  },
  "message": "Ho creato la pagina 'My New Page' come richiesto."
}

Update site option:
{
  "type": "execute_code",
  "target": "system",
  "details": {
    "description": "Update site tagline",
    "code": "update_option('blogdescription', 'New tagline here'); echo 'Tagline updated successfully.';",
    "estimated_risk": "low"
  },
  "message": "Ho aggiornato il tagline del sito."
}

Create WooCommerce product:
{
  "type": "execute_code",
  "target": "system",
  "details": {
    "description": "Create a simple WooCommerce product",
    "code": "if (!function_exists('wc_get_product')) { throw new Exception('WooCommerce not active'); } $product = new WC_Product_Simple(); $product->set_name('Test Product'); $product->set_regular_price('29.99'); $product->set_status('publish'); $product_id = $product->save(); echo 'Product created with ID: ' . $product_id;",
    "estimated_risk": "low"
  },
  "message": "Ho creato il prodotto WooCommerce 'Test Product'."
}

IMPORTANT RULES:
1. ALWAYS respond in the user's language
2. Generate COMPLETE, WORKING PHP code - don't describe what you would do
3. Handle errors gracefully with try/catch
4. Validate plugin availability before using plugin-specific functions
5. Use proper WordPress coding standards
6. Echo results for user feedback

Return ONLY the JSON object.`;


/**
 * Provider keys configuration
 */
export interface ModelServiceKeys {
  gemini: string;
  claude: string;
}

/**
 * Model Service
 *
 * @class ModelService
 *
 * @description
 * Simple service that calls the selected AI model with automatic fallback.
 */
export class ModelService {
  private keys: ModelServiceKeys;
  private logger: Logger;

  constructor(keys: ModelServiceKeys, logger: Logger) {
    this.keys = keys;
    this.logger = logger.child({ service: "modelService" });
  }

  /**
   * Generate content using the selected model with fallback
   */
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = Date.now();
    const primaryModel = request.model;
    const fallbackModel = getFallbackModel(primaryModel);

    this.logger.info("Starting model generation", {
      model: primaryModel,
      prompt_length: request.prompt.length,
    });

    // Try primary model
    const primaryResult = await this.callModel(primaryModel, request);

    if (primaryResult.success) {
      this.logger.info("Primary model succeeded", {
        model: primaryModel,
        tokens: primaryResult.total_tokens,
        latency_ms: primaryResult.latency_ms,
      });

      return {
        ...primaryResult,
        used_fallback: false,
        latency_ms: Date.now() - startTime,
      };
    }

    // Primary failed, try fallback
    this.logger.warn("Primary model failed, trying fallback", {
      primary: primaryModel,
      fallback: fallbackModel,
      error: primaryResult.error,
    });

    const fallbackResult = await this.callModel(fallbackModel, request);

    if (fallbackResult.success) {
      this.logger.info("Fallback model succeeded", {
        model: fallbackModel,
        tokens: fallbackResult.total_tokens,
        latency_ms: fallbackResult.latency_ms,
      });

      return {
        ...fallbackResult,
        used_fallback: true,
        latency_ms: Date.now() - startTime,
      };
    }

    // Both failed
    this.logger.error("Both models failed", {
      primary: primaryModel,
      fallback: fallbackModel,
      primary_error: primaryResult.error,
      fallback_error: fallbackResult.error,
    });

    return {
      success: false,
      content: "",
      model: primaryModel,
      model_id: MODEL_IDS[primaryModel],
      used_fallback: true,
      tokens_input: 0,
      tokens_output: 0,
      total_tokens: 0,
      cost_usd: 0,
      latency_ms: Date.now() - startTime,
      error: `Both models failed. Primary: ${primaryResult.error}. Fallback: ${fallbackResult.error}`,
      error_code: "ALL_MODELS_FAILED",
    };
  }

  /**
   * Call a specific model
   */
  private async callModel(
    model: AIModel,
    request: ModelRequest
  ): Promise<ModelResponse> {
    const startTime = Date.now();
    const modelId = MODEL_IDS[model];

    // Use default system prompt if none provided
    const systemPrompt = request.system_prompt || DEFAULT_SYSTEM_PROMPT;

    try {
      let response;

      if (model === "gemini") {
        const provider = new GeminiProvider(this.keys.gemini, modelId);
        response = await provider.generate(request.prompt, {
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens ?? 8000,
          system_prompt: systemPrompt,
          files: request.files,
        });
      } else {
        const provider = new ClaudeProvider(this.keys.claude, modelId);
        response = await provider.generate(request.prompt, {
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens ?? 8000,
          system_prompt: systemPrompt,
          files: request.files,
        });
      }

      if (response.success) {
        return {
          success: true,
          content: response.content,
          model,
          model_id: modelId,
          used_fallback: false,
          tokens_input: response.tokens_input,
          tokens_output: response.tokens_output,
          total_tokens: response.total_tokens,
          cost_usd: response.cost_usd,
          latency_ms: Date.now() - startTime,
        };
      }

      return {
        success: false,
        content: "",
        model,
        model_id: modelId,
        used_fallback: false,
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        error: response.error || "Unknown error",
        error_code: response.error_code || "UNKNOWN_ERROR",
      };
    } catch (error) {
      this.logger.error("Model call failed", {
        model,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        content: "",
        model,
        model_id: modelId,
        used_fallback: false,
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
        error_code: "PROVIDER_ERROR",
      };
    }
  }
}
