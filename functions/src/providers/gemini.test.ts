/**
 * @fileoverview Unit tests for Gemini Provider
 */

import { GeminiProvider } from "./gemini";
import { AIProviderError } from "../types/AIProvider";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Mock the Google Generative AI SDK
jest.mock("@google/generative-ai");

describe("GeminiProvider", () => {
  const TEST_API_KEY = "test-gemini-api-key";
  const mockGenerateContent = jest.fn();
  const mockCountTokens = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup GoogleGenerativeAI mock
    (GoogleGenerativeAI as unknown as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: jest.fn(() => ({
        generateContent: mockGenerateContent,
        countTokens: mockCountTokens,
      })),
    }));
  });

  describe("constructor", () => {
    it("should create provider with valid API key", () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.getProviderName()).toBe("gemini");
      expect(provider.getModel()).toBe("gemini-1.5-flash");
    });

    it("should create provider with custom model", () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-pro");

      expect(provider.getModel()).toBe("gemini-1.5-pro");
    });

    it("should throw error for empty API key", () => {
      expect(() => new GeminiProvider("")).toThrow(AIProviderError);
      expect(() => new GeminiProvider("")).toThrow("Gemini API key is required");
    });

    it("should throw error for whitespace-only API key", () => {
      expect(() => new GeminiProvider("   ")).toThrow(AIProviderError);
    });
  });

  describe("generate", () => {
    it("should generate content successfully", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => "Generated content from Gemini",
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 25,
          },
        },
      });

      const response = await provider.generate("Test prompt");

      expect(response.success).toBe(true);
      expect(response.provider).toBe("gemini");
      expect(response.model).toBe("gemini-1.5-flash");
      expect(response.content).toBe("Generated content from Gemini");
      expect(response.tokens_input).toBe(15);
      expect(response.tokens_output).toBe(25);
      expect(response.total_tokens).toBe(40);
      expect(response.cost_usd).toBeGreaterThanOrEqual(0);
      expect(response.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it("should handle rate limit error with retry", async () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-flash", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = new Error("429 RESOURCE_EXHAUSTED: Quota exceeded");

      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          response: {
            text: () => "Success after retry",
            usageMetadata: {
              promptTokenCount: 5,
              candidatesTokenCount: 10,
            },
          },
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.content).toBe("Success after retry");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on rate limit", async () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-flash", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = new Error("429 RESOURCE_EXHAUSTED");

      mockGenerateContent.mockRejectedValue(rateLimitError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("RATE_LIMITED");
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it("should not retry on authentication error", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      const authError = new Error("401 UNAUTHENTICATED: Invalid API key");

      mockGenerateContent.mockRejectedValueOnce(authError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("INVALID_API_KEY");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should handle content filtered error", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      const safetyError = new Error("SAFETY: Content blocked due to safety concerns");

      mockGenerateContent.mockRejectedValueOnce(safetyError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("CONTENT_FILTERED");
    });

    it("should handle timeout error", async () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-flash", {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const timeoutError = new Error("DEADLINE_EXCEEDED: Request timeout");

      mockGenerateContent.mockRejectedValue(timeoutError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("TIMEOUT");
    });

    it("should handle server errors with retry", async () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-flash", {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const serverError = new Error("500 INTERNAL: Server error");

      mockGenerateContent
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          response: {
            text: () => "Recovered",
            usageMetadata: {
              promptTokenCount: 5,
              candidatesTokenCount: 10,
            },
          },
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should handle missing usage metadata", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => "Content",
          usageMetadata: undefined,
        },
      });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.tokens_input).toBe(0);
      expect(response.tokens_output).toBe(0);
    });
  });

  describe("countTokens", () => {
    it("should count tokens using Gemini API", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      mockCountTokens.mockResolvedValueOnce({
        totalTokens: 42,
      });

      const count = await provider.countTokens("Hello world");

      expect(count).toBe(42);
    });

    it("should fallback to estimation on error", async () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      mockCountTokens.mockRejectedValueOnce(new Error("API error"));

      const count = await provider.countTokens("Hello world test");

      // Fallback: ~4 chars per token
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("getModel", () => {
    it("should return the model name", () => {
      const provider = new GeminiProvider(TEST_API_KEY, "gemini-1.5-pro");

      expect(provider.getModel()).toBe("gemini-1.5-pro");
    });
  });

  describe("getProviderName", () => {
    it("should return 'gemini'", () => {
      const provider = new GeminiProvider(TEST_API_KEY);

      expect(provider.getProviderName()).toBe("gemini");
    });
  });
});
