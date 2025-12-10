/**
 * @fileoverview Creator AI Proxy - Firebase Cloud Functions Entry Point
 * @module index
 *
 * @description
 * This is the main entry point for all Cloud Functions.
 * All functions are exported from this file and deployed to Firebase.
 *
 * @version 1.0.0
 * @author Creator AI Team
 */

// ==================== AUTH ENDPOINTS ====================

/**
 * POST /api/auth/validate-license
 *
 * Validates a license key and returns JWT token for authenticated access.
 *
 * @see {@link module:api/auth/validateLicense}
 */
export { validateLicense } from "./api/auth/validateLicense";

// ==================== AI ENDPOINTS (Milestone 4) ====================

/**
 * POST /api/ai/route-request
 *
 * Routes AI generation requests to the optimal provider with fallback.
 *
 * @see {@link module:api/ai/routeRequest}
 */
export { routeRequest } from "./api/ai/routeRequest";

// ==================== TASK ENDPOINTS (Milestone 5) ====================

/**
 * POST /api/tasks/submit
 *
 * Submits an async task for background processing.
 * Returns a job_id that can be used to poll status.
 *
 * @see {@link module:api/tasks/submitTask}
 */
export { submitTask } from "./api/tasks/submitTask";

/**
 * GET /api/tasks/status/:job_id
 *
 * Retrieves the current status of an async job.
 *
 * @see {@link module:api/tasks/getStatus}
 */
export { getTaskStatus } from "./api/tasks/getStatus";

// ==================== ANALYTICS ENDPOINTS (Milestone 6) ====================

/**
 * GET /api/analytics
 *
 * Returns cost tracking and usage analytics for a license.
 * Provides dashboard-ready data including totals and breakdowns.
 *
 * @see {@link module:api/analytics/getAnalytics}
 */
export { getAnalytics } from "./api/analytics/getAnalytics";

// ==================== PLUGIN DOCS REPOSITORY ====================

/**
 * GET /api/plugin-docs/:plugin_slug/:version
 *
 * Retrieves plugin documentation from the centralized cache.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { getPluginDocsApi } from "./api/plugin-docs/pluginDocs";

/**
 * POST /api/plugin-docs
 *
 * Saves plugin documentation to the centralized cache.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { savePluginDocsApi } from "./api/plugin-docs/pluginDocs";

/**
 * GET /api/plugin-docs/stats
 *
 * Returns statistics about the plugin docs repository.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { getPluginDocsStatsApi } from "./api/plugin-docs/pluginDocs";

/**
 * GET /api/plugin-docs/all/:plugin_slug
 *
 * Returns all cached versions for a specific plugin.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { getPluginDocsAllVersionsApi } from "./api/plugin-docs/pluginDocs";

/**
 * POST /api/plugin-docs/research
 *
 * Researches plugin documentation using AI when not found in cache.
 * Uses Gemini/Claude to find official docs and main functions.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { researchPluginDocsApi } from "./api/plugin-docs/pluginDocs";

/**
 * POST /api/plugin-docs/sync
 *
 * Returns plugin docs for syncing to WordPress local cache.
 * Used by Creator plugin to maintain a local fallback.
 *
 * @see {@link module:api/plugin-docs/pluginDocs}
 */
export { syncPluginDocsApi } from "./api/plugin-docs/pluginDocs";

// ==================== FIRESTORE TRIGGERS (Milestone 5) ====================

/**
 * Firestore trigger: job_queue/{jobId}
 *
 * Automatically processes jobs when created in job_queue collection.
 * Handles retry logic and updates job status.
 *
 * @see {@link module:triggers/jobQueueTrigger}
 */
export { processJobQueue } from "./triggers/jobQueueTrigger";
