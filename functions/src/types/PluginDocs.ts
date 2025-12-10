/**
 * @fileoverview Plugin Documentation types for Creator AI Proxy
 * @module types/PluginDocs
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Research metadata for AI-researched plugin docs
 */
export interface ResearchMetadata {
  /** When the research was performed */
  researched_at: Timestamp;

  /** AI provider used for research */
  ai_provider: "gemini" | "claude";

  /** Model ID used */
  model_id: string;

  /** Primary source URL for research */
  research_source?: string;

  /** Whether the docs have been verified */
  verified: boolean;

  /** Tokens used for research */
  tokens_used?: number;

  /** Cost in USD for research */
  cost_usd?: number;
}

/**
 * Plugin documentation cache entry
 */
export interface PluginDocsEntry {
  /** Plugin slug (e.g., "advanced-custom-fields") */
  plugin_slug: string;

  /** Plugin version (e.g., "6.2.5") */
  plugin_version: string;

  /** Official documentation URL */
  docs_url: string;

  /** Functions documentation URL */
  functions_url?: string;

  /** Main functions provided by the plugin */
  main_functions: string[];

  /** API reference URL if available */
  api_reference?: string;

  /** Version-specific notes */
  version_notes?: string[];

  /** When this entry was cached */
  cached_at: Timestamp;

  /** User ID who cached this entry */
  cached_by?: string;

  /** Number of cache hits */
  cache_hits: number;

  /** Source of the documentation (ai_research, manual, fallback) */
  source: "ai_research" | "manual" | "fallback";

  /** Last verification timestamp */
  last_verified?: Timestamp;

  /** Research metadata for AI-researched docs */
  research_meta?: ResearchMetadata;
}

/**
 * Data for creating a new plugin docs entry
 */
export interface CreatePluginDocsData {
  plugin_slug: string;
  plugin_version: string;
  docs_url: string;
  main_functions: string[];
  api_reference?: string;
  version_notes?: string[];
  cached_by?: string;
  source?: "ai_research" | "manual" | "fallback";
}

/**
 * Plugin docs repository statistics
 */
export interface PluginDocsStats {
  /** Total number of cached entries */
  total_entries: number;

  /** Total cache hits across all entries */
  total_cache_hits: number;

  /** Cache hit rate percentage */
  cache_hit_rate: number;

  /** Number of AI research operations performed */
  ai_research_count: number;

  /** Most requested plugins */
  most_requested: Array<{
    plugin_slug: string;
    request_count: number;
    versions_cached: number;
  }>;

  /** Last updated timestamp */
  last_updated: Timestamp;
}

/**
 * Request body for getting plugin docs
 */
export interface GetPluginDocsRequest {
  plugin_slug: string;
  plugin_version: string;
}

/**
 * Request body for saving plugin docs
 */
export interface SavePluginDocsRequest {
  plugin_slug: string;
  plugin_version: string;
  data: {
    docs_url: string;
    main_functions: string[];
    api_reference?: string;
    version_notes?: string[];
  };
  cached_by?: string;
}

/**
 * Response for plugin docs operations
 */
export interface PluginDocsResponse {
  success: boolean;
  data?: PluginDocsEntry | null;
  cached: boolean;
  source?: string;
  error?: string;
}

/**
 * Request body for researching plugin docs
 */
export interface ResearchPluginDocsRequest {
  plugin_slug: string;
  plugin_version: string;
  plugin_name?: string;
  plugin_uri?: string;
}

/**
 * Response from AI research
 */
export interface ResearchPluginDocsResponse {
  success: boolean;
  data?: {
    docs_url: string;
    functions_url?: string;
    main_functions: string[];
    api_reference?: string;
    version_notes?: string[];
  };
  research_meta?: {
    ai_provider: "gemini" | "claude";
    model_id: string;
    tokens_used: number;
    cost_usd: number;
  };
  error?: string;
}

/**
 * Request body for syncing plugin docs to WordPress
 */
export interface SyncPluginDocsRequest {
  plugin_slugs?: string[];
  since_timestamp?: string;
  limit?: number;
}

/**
 * Response for sync operation
 */
export interface SyncPluginDocsResponse {
  success: boolean;
  data?: {
    synced_count: number;
    plugins: Array<{
      plugin_slug: string;
      plugin_version: string;
      docs_url: string;
      main_functions: string[];
    }>;
  };
  error?: string;
}
