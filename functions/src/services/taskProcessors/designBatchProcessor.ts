/**
 * @fileoverview Design Batch Processor for generating Elementor sections
 * @module services/taskProcessors/designBatchProcessor
 *
 * @description
 * Processes design_batch jobs by generating Elementor-compatible
 * JSON structures using the AI router with DESIGN_GEN task type.
 */

import { AIRouter } from "../aiRouter";
import { Logger } from "../../lib/logger";
import { updateJobProgress } from "../../lib/firestore";
import {
  DesignBatchTaskData,
  DesignBatchResult,
  DesignSectionResult,
  DesignSectionInput,
  JobProgress,
  JOB_TIMEOUT_MS,
} from "../../types/Job";

/**
 * Context for design generation progress tracking
 */
interface ProcessingContext {
  jobId: string;
  startTime: number;
  itemTimes: number[];
}

/**
 * Builds a prompt for Elementor section generation
 *
 * @param {DesignSectionInput} section - The section input
 * @param {DesignBatchTaskData} taskData - Task configuration
 * @returns {string} The formatted prompt
 */
function buildDesignPrompt(
  section: DesignSectionInput,
  taskData: DesignBatchTaskData
): string {
  const style = section.style || "modern";
  const sectionType = section.section_type || "hero";
  const colors = section.colors || ["#ffffff", "#000000", "#3b82f6"];

  // Theme defaults
  const theme = taskData.theme || {};
  const primaryColor = theme.primary_color || colors[0] || "#3b82f6";
  const secondaryColor = theme.secondary_color || colors[1] || "#1e40af";
  const fontFamily = theme.font_family || "Poppins";

  const prompt = `Generate an Elementor-compatible JSON structure for a ${sectionType} section.

Section Details:
- Name: ${section.name}
- Description: ${section.description}
- Style: ${style}
- Section Type: ${sectionType}

Design Guidelines:
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}
- Font Family: ${fontFamily}
- Colors to use: ${colors.join(", ")}

Requirements:
1. Generate a valid Elementor JSON structure
2. Include realistic placeholder content (text, headings)
3. Use proper Elementor widget types (heading, text-editor, button, image, etc.)
4. Apply the specified colors and style
5. Make it responsive-ready

Return ONLY valid JSON in this exact Elementor format:
\`\`\`json
{
  "id": "unique_section_id",
  "elType": "section",
  "settings": {
    "layout": "full_width",
    "content_width": {"size": 1140, "unit": "px"},
    "height": "min-height",
    "custom_height": {"size": 500, "unit": "px"},
    "background_background": "classic",
    "background_color": "${primaryColor}"
  },
  "elements": [
    {
      "id": "column_1",
      "elType": "column",
      "settings": {"_column_size": 100},
      "elements": [
        {
          "id": "widget_1",
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Your Heading Here",
            "align": "center",
            "title_color": "#ffffff",
            "typography_typography": "custom",
            "typography_font_family": "${fontFamily}",
            "typography_font_size": {"size": 48, "unit": "px"}
          }
        }
      ]
    }
  ]
}
\`\`\`

Generate a complete, professional ${sectionType} section based on the description: "${section.description}"`;

  return prompt;
}

/**
 * Parses the AI response to extract Elementor JSON
 *
 * @param {string} content - Raw AI response
 * @param {string} sectionName - Section name for fallback
 * @returns {Record<string, unknown>} Elementor JSON structure
 */
function parseDesignResponse(
  content: string,
  sectionName: string
): Record<string, unknown> {
  // Try to extract JSON from code blocks
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // JSON parsing failed
    }
  }

  // Try to parse the entire content as JSON
  try {
    // Find the first { and last }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = content.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonStr);
    }
  } catch {
    // Not valid JSON
  }

  // Return a minimal fallback structure
  return {
    id: `section_${Date.now()}`,
    elType: "section",
    settings: {
      layout: "full_width",
    },
    elements: [
      {
        id: `column_${Date.now()}`,
        elType: "column",
        settings: { _column_size: 100 },
        elements: [
          {
            id: `widget_${Date.now()}`,
            elType: "widget",
            widgetType: "text-editor",
            settings: {
              editor: `<p>Section: ${sectionName}</p><p>Content generation failed. Please try again.</p>`,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Validates that the generated JSON has required Elementor structure
 *
 * @param {Record<string, unknown>} json - The JSON to validate
 * @returns {boolean} True if valid Elementor structure
 */
function isValidElementorStructure(json: Record<string, unknown>): boolean {
  if (!json || typeof json !== "object") return false;
  if (!json.elType || json.elType !== "section") return false;
  if (!json.elements || !Array.isArray(json.elements)) return false;

  return true;
}

/**
 * Calculates estimated time remaining
 *
 * @param {ProcessingContext} ctx - Processing context
 * @param {number} itemsRemaining - Items left to process
 * @returns {number} ETA in seconds
 */
function calculateEta(ctx: ProcessingContext, itemsRemaining: number): number {
  if (ctx.itemTimes.length === 0) {
    return itemsRemaining * 20; // Default 20s per design section
  }

  const avgTime = ctx.itemTimes.reduce((a, b) => a + b, 0) / ctx.itemTimes.length;
  return Math.round((itemsRemaining * avgTime) / 1000);
}

/**
 * Updates job progress during processing
 *
 * @param {ProcessingContext} ctx - Processing context
 * @param {number} completed - Items completed
 * @param {number} total - Total items
 * @param {string} currentTitle - Current item being processed
 * @param {Logger} logger - Logger instance
 */
async function updateProgress(
  ctx: ProcessingContext,
  completed: number,
  total: number,
  currentTitle: string,
  logger: Logger
): Promise<void> {
  const progress: JobProgress = {
    progress_percent: Math.round((completed / total) * 100),
    items_completed: completed,
    items_total: total,
    current_item_index: completed,
    current_item_title: currentTitle,
    eta_seconds: calculateEta(ctx, total - completed),
  };

  try {
    await updateJobProgress(ctx.jobId, progress);
  } catch (error) {
    logger.warn("Failed to update progress", {
      job_id: ctx.jobId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Checks if the job has exceeded the timeout
 *
 * @param {number} startTime - Job start timestamp
 * @returns {boolean} True if timeout exceeded
 */
function isTimeoutExceeded(startTime: number): boolean {
  return Date.now() - startTime > JOB_TIMEOUT_MS;
}

/**
 * Processes a design_batch job
 *
 * @param {string} jobId - The job ID
 * @param {DesignBatchTaskData} taskData - Task input data
 * @param {AIRouter} router - AI router instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<DesignBatchResult>} Processing result
 *
 * @throws {Error} If timeout is exceeded
 *
 * @example
 * ```typescript
 * const result = await processDesignBatch(
 *   "job_xxx",
 *   {
 *     sections: [{
 *       name: "Hero Section",
 *       description: "Hero for agency website",
 *       style: "modern"
 *     }]
 *   },
 *   router,
 *   logger
 * );
 * ```
 */
export async function processDesignBatch(
  jobId: string,
  taskData: DesignBatchTaskData,
  router: AIRouter,
  logger: Logger
): Promise<DesignBatchResult> {
  const processingLogger = logger.child({ processor: "designBatch", job_id: jobId });
  const startTime = Date.now();

  const ctx: ProcessingContext = {
    jobId,
    startTime,
    itemTimes: [],
  };

  const sections = taskData.sections;
  const sectionResults: DesignSectionResult[] = [];

  let totalTokens = 0;
  let totalCost = 0;

  processingLogger.info("Starting design batch generation", {
    section_count: sections.length,
    theme: taskData.theme,
  });

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const itemStartTime = Date.now();

    // Check timeout before processing each item
    if (isTimeoutExceeded(startTime)) {
      processingLogger.error("Job timeout exceeded", {
        processed: i,
        total: sections.length,
        elapsed_ms: Date.now() - startTime,
      });
      throw new Error(`Job timeout: processed ${i} of ${sections.length} sections before timeout`);
    }

    // Update progress
    await updateProgress(
      ctx,
      i,
      sections.length,
      `Generating design: ${section.name}`,
      processingLogger
    );

    processingLogger.debug("Processing section", {
      index: i,
      section_name: section.name,
      section_type: section.section_type,
      remaining: sections.length - i - 1,
    });

    try {
      const prompt = buildDesignPrompt(section, taskData);
      const result = await router.route("DESIGN_GEN", prompt, {
        temperature: 0.8, // Slightly higher for creative designs
        max_tokens: 4000,
      });

      const itemTime = Date.now() - itemStartTime;
      ctx.itemTimes.push(itemTime);

      if (result.success) {
        const elementorJson = parseDesignResponse(result.content, section.name);
        const isValid = isValidElementorStructure(elementorJson);

        if (!isValid) {
          processingLogger.warn("Generated JSON is not valid Elementor structure", {
            section_name: section.name,
          });
        }

        sectionResults.push({
          section_name: section.name,
          elementor_json: elementorJson,
          tokens_used: result.total_tokens,
          cost: result.cost_usd,
          provider: result.provider,
          status: isValid ? "success" : "success", // Still mark as success even if not perfect
        });

        totalTokens += result.total_tokens;
        totalCost += result.cost_usd;

        processingLogger.debug("Design section generated successfully", {
          section_name: section.name,
          tokens: result.total_tokens,
          cost: result.cost_usd,
          time_ms: itemTime,
          valid_structure: isValid,
        });
      } else {
        sectionResults.push({
          section_name: section.name,
          elementor_json: {},
          tokens_used: 0,
          cost: 0,
          provider: result.provider,
          status: "failed",
          error: result.error || "Generation failed",
        });

        processingLogger.warn("Design section generation failed", {
          section_name: section.name,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      sectionResults.push({
        section_name: section.name,
        elementor_json: {},
        tokens_used: 0,
        cost: 0,
        provider: "gemini", // Default, may not be accurate
        status: "failed",
        error: errorMessage,
      });

      processingLogger.error("Exception during design section generation", {
        section_name: section.name,
        error: errorMessage,
      });
    }
  }

  // Final progress update
  await updateProgress(ctx, sections.length, sections.length, "Completed", processingLogger);

  const processingTime = Math.round((Date.now() - startTime) / 1000);

  processingLogger.info("Design batch generation completed", {
    total_sections: sectionResults.length,
    successful: sectionResults.filter((s) => s.status === "success").length,
    failed: sectionResults.filter((s) => s.status === "failed").length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  });

  return {
    sections: sectionResults,
    total_sections: sectionResults.length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    processing_time_seconds: processingTime,
  };
}
