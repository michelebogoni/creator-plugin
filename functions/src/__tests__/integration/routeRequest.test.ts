/**
 * @fileoverview Integration tests for /api/ai/route-request endpoint
 * @module __tests__/integration/routeRequest.test
 *
 * @description
 * Tests the ModelService which handles AI provider selection and fallback logic.
 * The route-request endpoint uses ModelService for Gemini ↔ Claude fallback.
 */

import { ModelService, ModelServiceKeys } from "../../services/modelService";
import { GeminiProvider } from "../../providers/gemini";
import { ClaudeProvider } from "../../providers/claude";
import { Logger } from "../../lib/logger";
import { AI_MODELS } from "../../config/models";

// Mock providers
jest.mock("../../providers/gemini");
jest.mock("../../providers/claude");

/**
 * Creates a mock logger for testing
 */
function createMockLogger(): Logger {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mockLogger),
  } as unknown as Logger;
  return mockLogger;
}

/**
 * Creates a successful provider response
 */
function createSuccessResponse(model: "gemini" | "claude", content: string = "Generated content") {
  return {
    success: true,
    provider: model,
    model: model === "gemini" ? AI_MODELS.gemini.id : AI_MODELS.claude.id,
    content,
    tokens_input: 100,
    tokens_output: 50,
    total_tokens: 150,
    cost_usd: 0.001,
    latency_ms: 500,
  };
}

/**
 * Creates a failed provider response
 */
function createFailedResponse(model: "gemini" | "claude", error: string = "Provider error") {
  return {
    success: false,
    provider: model,
    model: model === "gemini" ? AI_MODELS.gemini.id : AI_MODELS.claude.id,
    content: "",
    tokens_input: 0,
    tokens_output: 0,
    total_tokens: 0,
    cost_usd: 0,
    latency_ms: 0,
    error,
    error_code: "PROVIDER_ERROR",
  };
}

describe("ModelService - Route Request Integration", () => {
  let mockLogger: Logger;
  const mockKeys: ModelServiceKeys = {
    gemini: "test-gemini-key",
    claude: "test-claude-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe("Test 1: Request con provider=gemini deve usare GeminiProvider", () => {
    it("should use GeminiProvider and return gemini-2.5-pro model ID", async () => {
      const geminiResponse = createSuccessResponse("gemini", "Gemini generated content");

      (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
        jest.fn().mockResolvedValue(geminiResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "gemini",
        prompt: "test prompt",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("gemini");
      expect(result.model_id).toBe(AI_MODELS.gemini.id); // "gemini-2.5-pro"
      expect(result.content).toBe("Gemini generated content");
      expect(result.used_fallback).toBe(false);
      expect(GeminiProvider).toHaveBeenCalledWith(mockKeys.gemini, AI_MODELS.gemini.id);
    });
  });

  describe("Test 2: Se GeminiProvider fallisce, fallback a Claude automatico", () => {
    it("should fallback to ClaudeProvider when GeminiProvider fails", async () => {
      const geminiFailResponse = createFailedResponse("gemini", "Gemini rate limited");
      const claudeSuccessResponse = createSuccessResponse("claude", "Claude fallback content");

      (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
        jest.fn().mockResolvedValue(geminiFailResponse);
      (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
        jest.fn().mockResolvedValue(claudeSuccessResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "gemini",
        prompt: "test prompt",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("claude");
      expect(result.model_id).toBe(AI_MODELS.claude.id); // "claude-opus-4-5-20251101"
      expect(result.content).toBe("Claude fallback content");
      expect(result.used_fallback).toBe(true);

      // Verify both providers were called
      expect(GeminiProvider.prototype.generate).toHaveBeenCalledTimes(1);
      expect(ClaudeProvider.prototype.generate).toHaveBeenCalledTimes(1);
    });

    it("should fallback to ClaudeProvider when GeminiProvider throws exception", async () => {
      const claudeSuccessResponse = createSuccessResponse("claude", "Claude recovered");

      (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
        jest.fn().mockRejectedValue(new Error("Network timeout"));
      (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
        jest.fn().mockResolvedValue(claudeSuccessResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "gemini",
        prompt: "test prompt",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("claude");
      expect(result.used_fallback).toBe(true);
    });
  });

  describe("Test 3: Request con provider=claude deve usare ClaudeProvider", () => {
    it("should use ClaudeProvider and return claude-opus-4-5-20251101 model ID", async () => {
      const claudeResponse = createSuccessResponse("claude", "Claude generated content");

      (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
        jest.fn().mockResolvedValue(claudeResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "claude",
        prompt: "test prompt",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("claude");
      expect(result.model_id).toBe(AI_MODELS.claude.id); // "claude-opus-4-5-20251101"
      expect(result.content).toBe("Claude generated content");
      expect(result.used_fallback).toBe(false);
      expect(ClaudeProvider).toHaveBeenCalledWith(mockKeys.claude, AI_MODELS.claude.id);
    });

    it("should fallback to Gemini when Claude fails", async () => {
      const claudeFailResponse = createFailedResponse("claude", "Claude unavailable");
      const geminiSuccessResponse = createSuccessResponse("gemini", "Gemini fallback content");

      (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
        jest.fn().mockResolvedValue(claudeFailResponse);
      (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
        jest.fn().mockResolvedValue(geminiSuccessResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "claude",
        prompt: "test prompt",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("gemini");
      expect(result.model_id).toBe(AI_MODELS.gemini.id);
      expect(result.used_fallback).toBe(true);
    });
  });

  describe("Test 4: Se provider non valido → errore 400", () => {
    it("should return error for invalid provider in isValidProvider check", () => {
      // This test validates the isValidProvider type guard used in routeRequest.ts
      // The actual 400 error is returned by the endpoint, not ModelService
      // Here we test that isValidProvider correctly rejects invalid providers

      const { isValidProvider } = require("../../types/ModelConfig");

      expect(isValidProvider("gemini")).toBe(true);
      expect(isValidProvider("claude")).toBe(true);
      expect(isValidProvider("openai")).toBe(false);
      expect(isValidProvider("gpt-4")).toBe(false);
      expect(isValidProvider("")).toBe(false);
      expect(isValidProvider(null)).toBe(false);
      expect(isValidProvider(undefined)).toBe(false);
    });
  });

  describe("Both providers fail", () => {
    it("should return error when both Gemini and Claude fail", async () => {
      const geminiFailResponse = createFailedResponse("gemini", "Gemini error");
      const claudeFailResponse = createFailedResponse("claude", "Claude error");

      (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
        jest.fn().mockResolvedValue(geminiFailResponse);
      (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
        jest.fn().mockResolvedValue(claudeFailResponse);

      const service = new ModelService(mockKeys, mockLogger);
      const result = await service.generate({
        model: "gemini",
        prompt: "test prompt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Both models failed");
      expect(result.error_code).toBe("ALL_MODELS_FAILED");
      expect(result.used_fallback).toBe(true);
    });
  });
});
