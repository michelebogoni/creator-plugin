/**
 * @fileoverview Unit tests for OpenAI Provider
 */

import { OpenAIProvider } from "./openai";
import { AIProviderError } from "../types/AIProvider";
import OpenAI from "openai";

// Mock the OpenAI SDK
jest.mock("openai");

// Mock tiktoken
jest.mock("tiktoken", () => ({
  encoding_for_model: jest.fn(() => ({
    encode: jest.fn((text: string) => new Array(Math.ceil(text.length / 4))),
    free: jest.fn(),
  })),
}));

/**
 * Helper to create mock API errors with status property
 */
function createMockAPIError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("OpenAIProvider", () => {
  const TEST_API_KEY = "sk-test-api-key-12345";
  const mockCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup OpenAI mock
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    }));
  });

  describe("constructor", () => {
    it("should create provider with valid API key", () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderName()).toBe("openai");
      expect(provider.getModel()).toBe("gpt-4o");
    });

    it("should create provider with custom model", () => {
      const provider = new OpenAIProvider(TEST_API_KEY, "gpt-4o-mini");

      expect(provider.getModel()).toBe("gpt-4o-mini");
    });

    it("should throw error for empty API key", () => {
      expect(() => new OpenAIProvider("")).toThrow(AIProviderError);
      expect(() => new OpenAIProvider("")).toThrow("OpenAI API key is required");
    });

    it("should throw error for whitespace-only API key", () => {
      expect(() => new OpenAIProvider("   ")).toThrow(AIProviderError);
    });
  });

  describe("generate", () => {
    it("should generate content successfully", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Generated content" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
        },
      });

      const response = await provider.generate("Test prompt");

      expect(response.success).toBe(true);
      expect(response.provider).toBe("openai");
      expect(response.model).toBe("gpt-4o");
      expect(response.content).toBe("Generated content");
      expect(response.tokens_input).toBe(10);
      expect(response.tokens_output).toBe(20);
      expect(response.total_tokens).toBe(30);
      expect(response.cost_usd).toBeGreaterThan(0);
      expect(response.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it("should use custom options", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Response" } }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      });

      await provider.generate("Test", {
        temperature: 0.5,
        max_tokens: 1000,
        system_prompt: "You are helpful",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
          max_tokens: 1000,
          messages: expect.arrayContaining([
            { role: "system", content: "You are helpful" },
            { role: "user", content: "Test" },
          ]),
        })
      );
    });

    it("should handle rate limit error with retry", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY, "gpt-4o", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = createMockAPIError(429, "Rate limited");

      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: "Success after retry" } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.content).toBe("Success after retry");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on rate limit", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY, "gpt-4o", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = createMockAPIError(429, "Rate limited");

      mockCreate.mockRejectedValue(rateLimitError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("RATE_LIMITED");
      expect(mockCreate).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should not retry on authentication error", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      const authError = createMockAPIError(401, "Invalid API key");

      mockCreate.mockRejectedValueOnce(authError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("INVALID_API_KEY");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("should handle timeout error", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY, "gpt-4o", {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const timeoutError = new Error("Request timeout exceeded");

      mockCreate.mockRejectedValue(timeoutError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("TIMEOUT");
    });

    it("should handle empty response content", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.content).toBe("");
    });
  });

  describe("countTokens", () => {
    it("should count tokens using tiktoken", async () => {
      const provider = new OpenAIProvider(TEST_API_KEY);
      const count = await provider.countTokens("Hello world");

      expect(count).toBeGreaterThan(0);
    });
  });

  describe("getModel", () => {
    it("should return the model name", () => {
      const provider = new OpenAIProvider(TEST_API_KEY, "gpt-4o-mini");

      expect(provider.getModel()).toBe("gpt-4o-mini");
    });
  });

  describe("getProviderName", () => {
    it("should return 'openai'", () => {
      const provider = new OpenAIProvider(TEST_API_KEY);

      expect(provider.getProviderName()).toBe("openai");
    });
  });
});
