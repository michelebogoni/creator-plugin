/**
 * @fileoverview Unit tests for Claude Provider
 */

import { ClaudeProvider } from "./claude";
import { AIProviderError } from "../types/AIProvider";
import Anthropic from "@anthropic-ai/sdk";

// Mock the Anthropic SDK
jest.mock("@anthropic-ai/sdk");

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

describe("ClaudeProvider", () => {
  const TEST_API_KEY = "sk-ant-test-api-key";
  const mockCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Anthropic mock
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    }));
  });

  describe("constructor", () => {
    it("should create provider with valid API key", () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      expect(provider).toBeInstanceOf(ClaudeProvider);
      expect(provider.getProviderName()).toBe("claude");
      expect(provider.getModel()).toBe("claude-3-5-sonnet-20241022");
    });

    it("should create provider with custom model", () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-opus-20240229");

      expect(provider.getModel()).toBe("claude-3-opus-20240229");
    });

    it("should throw error for empty API key", () => {
      expect(() => new ClaudeProvider("")).toThrow(AIProviderError);
      expect(() => new ClaudeProvider("")).toThrow("Claude API key is required");
    });

    it("should throw error for whitespace-only API key", () => {
      expect(() => new ClaudeProvider("   ")).toThrow(AIProviderError);
    });
  });

  describe("generate", () => {
    it("should generate content successfully", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Generated content from Claude" }],
        usage: {
          input_tokens: 12,
          output_tokens: 28,
        },
        stop_reason: "end_turn",
      });

      const response = await provider.generate("Test prompt");

      expect(response.success).toBe(true);
      expect(response.provider).toBe("claude");
      expect(response.model).toBe("claude-3-5-sonnet-20241022");
      expect(response.content).toBe("Generated content from Claude");
      expect(response.tokens_input).toBe(12);
      expect(response.tokens_output).toBe(28);
      expect(response.total_tokens).toBe(40);
      expect(response.cost_usd).toBeGreaterThan(0);
      expect(response.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it("should use custom options", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Response" }],
        usage: { input_tokens: 5, output_tokens: 10 },
        stop_reason: "end_turn",
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
          system: "You are helpful",
          messages: [{ role: "user", content: "Test" }],
        })
      );
    });

    it("should handle multiple content blocks", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      mockCreate.mockResolvedValueOnce({
        content: [
          { type: "text", text: "First part. " },
          { type: "text", text: "Second part." },
        ],
        usage: { input_tokens: 5, output_tokens: 10 },
        stop_reason: "end_turn",
      });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.content).toBe("First part. Second part.");
    });

    it("should handle rate limit error with retry", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-5-sonnet-20241022", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = createMockAPIError(429, "Rate limited");

      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Success after retry" }],
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: "end_turn",
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(response.content).toBe("Success after retry");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on rate limit", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-5-sonnet-20241022", {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const rateLimitError = createMockAPIError(429, "Rate limited");

      mockCreate.mockRejectedValue(rateLimitError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("RATE_LIMITED");
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it("should not retry on authentication error", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      const authError = createMockAPIError(401, "Invalid API key");

      mockCreate.mockRejectedValueOnce(authError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("INVALID_API_KEY");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("should handle timeout error", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-5-sonnet-20241022", {
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

    it("should handle overloaded error with retry", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-5-sonnet-20241022", {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const overloadedError = createMockAPIError(529, "Overloaded");

      mockCreate
        .mockRejectedValueOnce(overloadedError)
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Success" }],
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: "end_turn",
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should handle server errors with retry", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-5-sonnet-20241022", {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      });

      const serverError = createMockAPIError(500, "Internal error");

      mockCreate
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Recovered" }],
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: "end_turn",
        });

      const response = await provider.generate("Test");

      expect(response.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should not retry on bad request", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      const badRequestError = createMockAPIError(400, "Invalid request");

      mockCreate.mockRejectedValueOnce(badRequestError);

      const response = await provider.generate("Test");

      expect(response.success).toBe(false);
      expect(response.error_code).toBe("INVALID_REQUEST");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("countTokens", () => {
    it("should count tokens using tiktoken", async () => {
      const provider = new ClaudeProvider(TEST_API_KEY);
      const count = await provider.countTokens("Hello world test string");

      expect(count).toBeGreaterThan(0);
    });
  });

  describe("getModel", () => {
    it("should return the model name", () => {
      const provider = new ClaudeProvider(TEST_API_KEY, "claude-3-opus-20240229");

      expect(provider.getModel()).toBe("claude-3-opus-20240229");
    });
  });

  describe("getProviderName", () => {
    it("should return 'claude'", () => {
      const provider = new ClaudeProvider(TEST_API_KEY);

      expect(provider.getProviderName()).toBe("claude");
    });
  });
});
