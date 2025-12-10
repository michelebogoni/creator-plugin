/**
 * @fileoverview Plugin Documentation Research Service
 * @module services/pluginDocsResearch
 *
 * @description
 * Uses AI to research plugin documentation when not found in cache.
 * The AI searches for official documentation URLs and main functions.
 */

import { ModelService, ModelServiceKeys } from "./modelService";
import { Logger } from "../lib/logger";
import { savePluginDocs, getPluginDocs } from "../lib/firestore";
import {
  ResearchPluginDocsRequest,
  ResearchPluginDocsResponse,
  PluginDocsEntry,
} from "../types/PluginDocs";

/**
 * System prompt for plugin documentation research
 */
const RESEARCH_SYSTEM_PROMPT = `You are a WordPress plugin documentation researcher. Your task is to find official documentation and main functions for WordPress plugins.

IMPORTANT: You MUST respond ONLY with a valid JSON object (no markdown, no code blocks, just raw JSON).

Response format:
{
  "docs_url": "https://...",
  "functions_url": "https://...",
  "api_reference": "https://...",
  "main_functions": ["function_name()", "another_function()"],
  "version_notes": ["Note about this version"]
}

RULES:
1. docs_url: The main documentation page for the plugin
2. functions_url: The functions/API reference page if available
3. api_reference: Full API documentation URL if available
4. main_functions: List of the most important/commonly used functions (max 15)
5. version_notes: Any important notes about this specific version

If you cannot find official documentation, provide the WordPress.org plugin page URL as docs_url.

For popular plugins, use these known URLs:
- Advanced Custom Fields: https://www.advancedcustomfields.com/resources/
- WooCommerce: https://developer.woocommerce.com/docs/
- Elementor: https://developers.elementor.com/docs/
- Yoast SEO: https://developer.yoast.com/
- Contact Form 7: https://contactform7.com/docs/
- Gravity Forms: https://docs.gravityforms.com/
- WPForms: https://wpforms.com/docs/

For other plugins, use: https://wordpress.org/plugins/{plugin_slug}/`;

/**
 * Plugin Documentation Research Service
 */
export class PluginDocsResearchService {
  private modelService: ModelService;
  private logger: Logger;

  constructor(keys: ModelServiceKeys, logger: Logger) {
    this.modelService = new ModelService(keys, logger);
    this.logger = logger.child({ service: "pluginDocsResearch" });
  }

  /**
   * Research plugin documentation using AI
   *
   * @param request Research request with plugin details
   * @returns Research response with documentation data
   */
  async research(
    request: ResearchPluginDocsRequest
  ): Promise<ResearchPluginDocsResponse> {
    const { plugin_slug, plugin_version, plugin_name, plugin_uri } = request;

    this.logger.info("Starting plugin docs research", {
      plugin_slug,
      plugin_version,
    });

    // Check cache first
    const cached = await getPluginDocs(plugin_slug, plugin_version);
    if (cached) {
      this.logger.info("Plugin docs found in cache", { plugin_slug });
      return {
        success: true,
        data: {
          docs_url: cached.docs_url,
          functions_url: cached.functions_url,
          main_functions: cached.main_functions,
          api_reference: cached.api_reference,
          version_notes: cached.version_notes,
        },
      };
    }

    // Build research prompt
    const prompt = this.buildResearchPrompt(
      plugin_slug,
      plugin_version,
      plugin_name,
      plugin_uri
    );

    try {
      // Call AI to research
      const response = await this.modelService.generate({
        model: "gemini", // Use Gemini for research (faster/cheaper)
        prompt,
        system_prompt: RESEARCH_SYSTEM_PROMPT,
        temperature: 0.3, // Lower temperature for more factual responses
        max_tokens: 2000,
      });

      if (!response.success) {
        this.logger.error("AI research failed", {
          plugin_slug,
          error: response.error,
        });
        return {
          success: false,
          error: response.error || "AI research failed",
        };
      }

      // Parse AI response
      const parsed = this.parseResearchResponse(response.content);
      if (!parsed) {
        this.logger.error("Failed to parse AI response", {
          plugin_slug,
          content: response.content.substring(0, 500),
        });
        return {
          success: false,
          error: "Failed to parse AI research response",
        };
      }

      // Save to cache
      await savePluginDocs({
        plugin_slug,
        plugin_version,
        docs_url: parsed.docs_url,
        main_functions: parsed.main_functions,
        api_reference: parsed.api_reference,
        version_notes: parsed.version_notes,
        source: "ai_research",
      });

      // Update with research metadata
      // Note: We'd need to update firestore.ts to support research_meta
      this.logger.info("Plugin docs researched and cached", {
        plugin_slug,
        plugin_version,
        docs_url: parsed.docs_url,
        functions_count: parsed.main_functions.length,
      });

      return {
        success: true,
        data: parsed,
        research_meta: {
          ai_provider: response.model as "gemini" | "claude",
          model_id: response.model_id,
          tokens_used: response.total_tokens,
          cost_usd: response.cost_usd,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Research failed with exception", {
        plugin_slug,
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the research prompt for a plugin
   */
  private buildResearchPrompt(
    slug: string,
    version: string,
    name?: string,
    uri?: string
  ): string {
    let prompt = `Research the WordPress plugin documentation for:\n\n`;
    prompt += `Plugin Slug: ${slug}\n`;
    prompt += `Version: ${version}\n`;

    if (name) {
      prompt += `Plugin Name: ${name}\n`;
    }

    if (uri) {
      prompt += `Plugin URI: ${uri}\n`;
    }

    prompt += `\nFind the official documentation URL and list the main functions/hooks this plugin provides.`;
    prompt += `\n\nIf this is a well-known plugin, provide the actual documentation URLs.`;
    prompt += `\nFor less known plugins, use the WordPress.org plugin page.`;

    return prompt;
  }

  /**
   * Parse the AI research response
   */
  private parseResearchResponse(
    content: string
  ): ResearchPluginDocsResponse["data"] | null {
    try {
      // Try to extract JSON from the response
      let jsonStr = content.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith("```")) {
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          jsonStr = match[1];
        }
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.docs_url || !Array.isArray(parsed.main_functions)) {
        return null;
      }

      return {
        docs_url: parsed.docs_url,
        functions_url: parsed.functions_url,
        main_functions: parsed.main_functions.slice(0, 15), // Max 15 functions
        api_reference: parsed.api_reference,
        version_notes: parsed.version_notes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get or research plugin docs
   *
   * Checks cache first, then researches if not found.
   *
   * @param request Research request
   * @returns Plugin docs entry
   */
  async getOrResearch(
    request: ResearchPluginDocsRequest
  ): Promise<PluginDocsEntry | null> {
    const { plugin_slug, plugin_version } = request;

    // Check cache first
    const cached = await getPluginDocs(plugin_slug, plugin_version);
    if (cached) {
      return cached;
    }

    // Research and cache
    const result = await this.research(request);
    if (!result.success || !result.data) {
      return null;
    }

    // Return the cached entry
    return getPluginDocs(plugin_slug, plugin_version);
  }
}

/**
 * Well-known plugin documentation URLs
 * Used as fallback for popular plugins
 */
export const KNOWN_PLUGIN_DOCS: Record<
  string,
  { docs_url: string; api_reference?: string; main_functions: string[] }
> = {
  "advanced-custom-fields": {
    docs_url: "https://www.advancedcustomfields.com/resources/",
    api_reference: "https://www.advancedcustomfields.com/resources/#functions",
    main_functions: [
      "get_field()",
      "update_field()",
      "get_field_object()",
      "have_rows()",
      "the_row()",
      "get_sub_field()",
      "acf_add_local_field_group()",
      "acf_add_local_field()",
      "acf_get_field_groups()",
    ],
  },
  woocommerce: {
    docs_url: "https://developer.woocommerce.com/docs/",
    api_reference: "https://woocommerce.github.io/code-reference/",
    main_functions: [
      "wc_get_product()",
      "wc_create_order()",
      "wc_get_orders()",
      "WC()->cart",
      "WC()->session",
      "wc_add_notice()",
      "wc_price()",
      "wc_get_template()",
      "wc_get_product_terms()",
    ],
  },
  elementor: {
    docs_url: "https://developers.elementor.com/docs/",
    api_reference: "https://developers.elementor.com/docs/scripts-styles/",
    main_functions: [
      "\\Elementor\\Plugin::instance()",
      "\\Elementor\\Controls_Manager",
      "\\Elementor\\Widget_Base",
      "elementor_get_option()",
      "\\Elementor\\Core\\Documents_Manager",
    ],
  },
  "contact-form-7": {
    docs_url: "https://contactform7.com/docs/",
    main_functions: [
      "wpcf7_add_form_tag()",
      "wpcf7_submit",
      "wpcf7_before_send_mail",
      "wpcf7_mail_sent",
    ],
  },
  "wordpress-seo": {
    docs_url: "https://developer.yoast.com/",
    api_reference: "https://developer.yoast.com/customization/apis/",
    main_functions: [
      "wpseo_title",
      "wpseo_metadesc",
      "wpseo_opengraph",
      "wpseo_robots",
      "wpseo_breadcrumb",
    ],
  },
  "gravityforms": {
    docs_url: "https://docs.gravityforms.com/",
    api_reference: "https://docs.gravityforms.com/category/developers/",
    main_functions: [
      "GFAPI::get_form()",
      "GFAPI::get_entries()",
      "GFAPI::add_entry()",
      "GFAPI::update_entry()",
      "GFFormsModel::get_form_meta()",
    ],
  },
};

/**
 * Get fallback docs for well-known plugins
 */
export function getFallbackDocs(
  pluginSlug: string
): (typeof KNOWN_PLUGIN_DOCS)[string] | null {
  return KNOWN_PLUGIN_DOCS[pluginSlug] || null;
}
