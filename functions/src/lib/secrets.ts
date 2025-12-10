/**
 * @fileoverview Firebase Secrets Manager integration
 * @module lib/secrets
 */

import { defineSecret } from "firebase-functions/params";

/**
 * JWT Secret for signing/verifying tokens
 * @description Loaded from Firebase Secrets Manager at runtime
 */
export const jwtSecret = defineSecret("JWT_SECRET");

/**
 * OpenAI API Key
 * @description Loaded from Firebase Secrets Manager at runtime
 */
export const openaiApiKey = defineSecret("OPENAI_API_KEY");

/**
 * Google Gemini API Key
 * @description Loaded from Firebase Secrets Manager at runtime
 */
export const geminiApiKey = defineSecret("GEMINI_API_KEY");

/**
 * Anthropic Claude API Key
 * @description Loaded from Firebase Secrets Manager at runtime
 */
export const claudeApiKey = defineSecret("CLAUDE_API_KEY");

/**
 * All secrets required for the application
 * @description Use this array when defining functions that need all secrets
 *
 * @example
 * ```typescript
 * export const myFunction = onRequest({ secrets: allSecrets }, async (req, res) => {
 *   const jwt = jwtSecret.value();
 *   // ...
 * });
 * ```
 */
export const allSecrets = [jwtSecret, openaiApiKey, geminiApiKey, claudeApiKey];

/**
 * Auth-related secrets only
 * @description Use for endpoints that only need JWT
 */
export const authSecrets = [jwtSecret];

/**
 * AI provider secrets only
 * @description Use for endpoints that call AI providers
 */
export const aiSecrets = [openaiApiKey, geminiApiKey, claudeApiKey];
