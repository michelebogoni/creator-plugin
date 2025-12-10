/**
 * @fileoverview Plugin Documentation Cache API
 * @module api/plugin-docs/pluginDocs
 *
 * @description
 * API endpoints for the centralized plugin documentation repository.
 * Provides caching and retrieval of plugin documentation across all Creator users.
 * Includes AI-powered research for cache misses.
 */

import * as functions from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "../../lib/logger";
import {
  getPluginDocs,
  savePluginDocs,
  incrementPluginDocsCacheHits,
  getPluginDocsStats,
  getPluginDocsAllVersions,
  db,
  COLLECTIONS,
} from "../../lib/firestore";
import {
  SavePluginDocsRequest,
  PluginDocsResponse,
  ResearchPluginDocsRequest,
  SyncPluginDocsRequest,
  PluginDocsEntry,
} from "../../types/PluginDocs";
import {
  PluginDocsResearchService,
  getFallbackDocs,
} from "../../services/pluginDocsResearch";
import { geminiApiKey, claudeApiKey } from "../../lib/secrets";

/**
 * GET /api/plugin-docs/:plugin_slug/:version
 *
 * Retrieves plugin documentation from the cache.
 * Increments cache hit counter on successful retrieval.
 *
 * @example
 * ```
 * GET /api/plugin-docs/advanced-custom-fields/6.2.5
 * ```
 */
export const getPluginDocsApi = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      // Extract plugin_slug and version from path
      // Path format: /plugin-docs/:plugin_slug/:version
      const pathParts = req.path.split("/").filter(Boolean);
      const pluginSlug = pathParts[0];
      const pluginVersion = pathParts[1];

      if (!pluginSlug || !pluginVersion) {
        res.status(400).json({
          success: false,
          error: "Missing plugin_slug or version in path",
        });
        return;
      }

      logger.info("Getting plugin docs", { pluginSlug, pluginVersion });

      // Get from cache
      const docs = await getPluginDocs(pluginSlug, pluginVersion);

      if (!docs) {
        // Cache miss
        res.status(404).json({
          success: false,
          cached: false,
          data: null,
          error: "Plugin documentation not found in cache",
        } as PluginDocsResponse);
        return;
      }

      // Increment cache hits (fire and forget)
      incrementPluginDocsCacheHits(pluginSlug, pluginVersion).catch((err) => {
        logger.warn("Failed to increment cache hits", { error: err.message });
      });

      res.status(200).json({
        success: true,
        cached: true,
        source: docs.source,
        data: docs,
      } as PluginDocsResponse);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error getting plugin docs", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

/**
 * POST /api/plugin-docs
 *
 * Saves plugin documentation to the cache.
 * Used when a Creator instance researches new plugin documentation.
 *
 * @example
 * ```
 * POST /api/plugin-docs
 * {
 *   "plugin_slug": "advanced-custom-fields",
 *   "plugin_version": "6.2.5",
 *   "data": {
 *     "docs_url": "https://www.advancedcustomfields.com/resources/",
 *     "main_functions": ["get_field()", "update_field()"],
 *     "api_reference": "https://www.advancedcustomfields.com/resources/#functions",
 *     "version_notes": ["6.2.5: Compatible with WordPress 6.7"]
 *   }
 * }
 * ```
 */
export const savePluginDocsApi = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body as SavePluginDocsRequest;

      // Validate required fields
      if (!body.plugin_slug || !body.plugin_version || !body.data) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: plugin_slug, plugin_version, data",
        });
        return;
      }

      if (!body.data.docs_url || !body.data.main_functions) {
        res.status(400).json({
          success: false,
          error: "Missing required data fields: docs_url, main_functions",
        });
        return;
      }

      logger.info("Saving plugin docs", {
        pluginSlug: body.plugin_slug,
        pluginVersion: body.plugin_version,
      });

      // Check if already exists
      const existing = await getPluginDocs(body.plugin_slug, body.plugin_version);
      if (existing) {
        // Already cached - just return success
        res.status(200).json({
          success: true,
          cached: true,
          source: existing.source,
          data: existing,
          message: "Documentation already cached",
        });
        return;
      }

      // Save to cache
      const entry = await savePluginDocs({
        plugin_slug: body.plugin_slug,
        plugin_version: body.plugin_version,
        docs_url: body.data.docs_url,
        main_functions: body.data.main_functions,
        api_reference: body.data.api_reference,
        version_notes: body.data.version_notes,
        cached_by: body.cached_by,
        source: "ai_research",
      });

      logger.info("Plugin docs saved successfully", {
        pluginSlug: body.plugin_slug,
        pluginVersion: body.plugin_version,
      });

      res.status(201).json({
        success: true,
        cached: true,
        source: entry.source,
        data: entry,
      } as PluginDocsResponse);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error saving plugin docs", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

/**
 * GET /api/plugin-docs/stats
 *
 * Returns statistics about the plugin docs repository.
 *
 * @example
 * ```
 * GET /api/plugin-docs/stats
 * ```
 */
export const getPluginDocsStatsApi = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const stats = await getPluginDocsStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error getting plugin docs stats", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

/**
 * GET /api/plugin-docs/all/:plugin_slug
 *
 * Returns all cached versions for a specific plugin.
 *
 * @example
 * ```
 * GET /api/plugin-docs/all/advanced-custom-fields
 * ```
 */
export const getPluginDocsAllVersionsApi = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      // Extract plugin_slug from path
      const pathParts = req.path.split("/").filter(Boolean);
      const pluginSlug = pathParts[0];

      if (!pluginSlug) {
        res.status(400).json({
          success: false,
          error: "Missing plugin_slug in path",
        });
        return;
      }

      const versions = await getPluginDocsAllVersions(pluginSlug);

      res.status(200).json({
        success: true,
        data: {
          plugin_slug: pluginSlug,
          versions_count: versions.length,
          versions: versions,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error getting all plugin versions", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

/**
 * POST /api/plugin-docs/research
 *
 * Researches plugin documentation using AI when not found in cache.
 * This is called when a Creator instance encounters a cache miss.
 *
 * @example
 * ```
 * POST /api/plugin-docs/research
 * {
 *   "plugin_slug": "my-plugin",
 *   "plugin_version": "1.0.0",
 *   "plugin_name": "My Plugin",
 *   "plugin_uri": "https://example.com/my-plugin"
 * }
 * ```
 */
export const researchPluginDocsApi = functions
  .region("us-central1")
  .runWith({ secrets: [geminiApiKey, claudeApiKey] })
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body as ResearchPluginDocsRequest;

      // Validate required fields
      if (!body.plugin_slug || !body.plugin_version) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: plugin_slug, plugin_version",
        });
        return;
      }

      logger.info("Researching plugin docs", {
        pluginSlug: body.plugin_slug,
        pluginVersion: body.plugin_version,
      });

      // Check cache first
      const cached = await getPluginDocs(body.plugin_slug, body.plugin_version);
      if (cached) {
        // Increment cache hits
        incrementPluginDocsCacheHits(body.plugin_slug, body.plugin_version).catch(
          (err) => {
            logger.warn("Failed to increment cache hits", { error: err.message });
          }
        );

        res.status(200).json({
          success: true,
          cached: true,
          source: cached.source,
          data: cached,
        } as PluginDocsResponse);
        return;
      }

      // Check for fallback docs for well-known plugins
      const fallback = getFallbackDocs(body.plugin_slug);
      if (fallback) {
        logger.info("Using fallback docs for known plugin", {
          pluginSlug: body.plugin_slug,
        });

        // Save fallback to cache
        const entry = await savePluginDocs({
          plugin_slug: body.plugin_slug,
          plugin_version: body.plugin_version,
          docs_url: fallback.docs_url,
          main_functions: fallback.main_functions,
          api_reference: fallback.api_reference,
          source: "fallback",
        });

        res.status(200).json({
          success: true,
          cached: true,
          source: "fallback",
          data: entry,
        } as PluginDocsResponse);
        return;
      }

      // Use AI to research
      const researchService = new PluginDocsResearchService(
        {
          gemini: geminiApiKey.value(),
          claude: claudeApiKey.value(),
        },
        logger
      );

      const result = await researchService.research(body);

      if (!result.success) {
        // Create a basic fallback entry
        const wpOrgUrl = `https://wordpress.org/plugins/${body.plugin_slug}/`;
        const fallbackEntry = await savePluginDocs({
          plugin_slug: body.plugin_slug,
          plugin_version: body.plugin_version,
          docs_url: wpOrgUrl,
          main_functions: [],
          source: "fallback",
        });

        res.status(200).json({
          success: true,
          cached: true,
          source: "fallback",
          data: fallbackEntry,
          warning: result.error,
        });
        return;
      }

      // Get the cached entry
      const entry = await getPluginDocs(body.plugin_slug, body.plugin_version);

      res.status(201).json({
        success: true,
        cached: true,
        source: "ai_research",
        data: entry,
        research_meta: result.research_meta,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error researching plugin docs", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

/**
 * POST /api/plugin-docs/sync
 *
 * Returns plugin docs for syncing to WordPress local cache.
 * Used by Creator plugin to maintain a local fallback.
 *
 * @example
 * ```
 * POST /api/plugin-docs/sync
 * {
 *   "plugin_slugs": ["woocommerce", "advanced-custom-fields"],
 *   "limit": 50
 * }
 * ```
 */
export const syncPluginDocsApi = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body as SyncPluginDocsRequest;
      const limit = Math.min(body.limit || 100, 500); // Max 500 entries

      logger.info("Syncing plugin docs", {
        pluginSlugs: body.plugin_slugs,
        sinceTimestamp: body.since_timestamp,
        limit,
      });

      let query = db
        .collection(COLLECTIONS.PLUGIN_DOCS_CACHE)
        .orderBy("cached_at", "desc")
        .limit(limit);

      // Filter by plugin slugs if provided
      if (body.plugin_slugs && body.plugin_slugs.length > 0) {
        // Firestore limits 'in' queries to 30 items
        const slugsToQuery = body.plugin_slugs.slice(0, 30);
        query = db
          .collection(COLLECTIONS.PLUGIN_DOCS_CACHE)
          .where("plugin_slug", "in", slugsToQuery)
          .orderBy("cached_at", "desc")
          .limit(limit);
      }

      // Filter by timestamp if provided
      if (body.since_timestamp) {
        const sinceDate = new Date(body.since_timestamp);
        query = query.where("cached_at", ">", Timestamp.fromDate(sinceDate));
      }

      const snapshot = await query.get();

      const plugins = snapshot.docs.map((doc) => {
        const data = doc.data() as PluginDocsEntry;
        return {
          plugin_slug: data.plugin_slug,
          plugin_version: data.plugin_version,
          docs_url: data.docs_url,
          main_functions: data.main_functions,
          api_reference: data.api_reference,
          version_notes: data.version_notes,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          synced_count: plugins.length,
          plugins,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error syncing plugin docs", { error: errorMessage });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });
