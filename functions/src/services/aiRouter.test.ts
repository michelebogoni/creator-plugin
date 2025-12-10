/**
 * @fileoverview Unit tests for AI Router service
 * @module services/aiRouter.test
 */

import { AIRouter, sanitizePrompt, validatePrompt } from "./aiRouter";
import { OpenAIProvider } from "../providers/openai";
import { GeminiProvider } from "../providers/gemini";
import { ClaudeProvider } from "../providers/claude";
import { AIResponse, ProviderName } from "../types/AIProvider";
import { Logger } from "../lib/logger";

// Mock providers
jest.mock("../providers/openai");
jest.mock("../providers/gemini");
jest.mock("../providers/claude");

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
 * Creates a successful AI response
 */
function createSuccessResponse(
  provider: ProviderName,
  model: string,
  content: string = "Generated content"
): AIResponse {
  return {
    success: true,
    provider,
    model,
    content,
    tokens_input: 100,
    tokens_output: 50,
    total_tokens: 150,
    cost_usd: 0.001,
    latency_ms: 500,
  };
}

/**
 * Creates a failed AI response
 */
function createFailedResponse(
  provider: ProviderName,
  model: string,
  error: string = "Provider error",
  errorCode: string = "PROVIDER_ERROR"
): AIResponse {
  return {
    success: false,
    provider,
    model,
    content: "",
    tokens_input: 0,
    tokens_output: 0,
    total_tokens: 0,
    cost_usd: 0,
    latency_ms: 0,
    error,
    error_code: errorCode,
  };
}

describe("AIRouter", () => {
  let router: AIRouter;
  let mockLogger: Logger;
  const mockKeys = {
    openai: "test-openai-key",
    gemini: "test-gemini-key",
    claude: "test-claude-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    router = new AIRouter(mockKeys, mockLogger);
  });

  describe("route", () => {
    describe("TEXT_GEN task type", () => {
      it("should route to Gemini (primary) for TEXT_GEN", async () => {
        const mockResponse = createSuccessResponse("gemini", "gemini-1.5-flash");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(mockResponse);

        const result = await router.route("TEXT_GEN", "Write a blog post");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("gemini");
        expect(result.model).toBe("gemini-1.5-flash");
        expect(result.providers_attempted).toEqual(["gemini"]);
      });

      it("should fallback to OpenAI when Gemini fails", async () => {
        const geminiFailResponse = createFailedResponse("gemini", "gemini-1.5-flash", "Rate limited");
        const openaiSuccessResponse = createSuccessResponse("openai", "gpt-4o-mini");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(geminiFailResponse);
        (OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>).prototype.generate =
          jest.fn().mockResolvedValue(openaiSuccessResponse);

        const result = await router.route("TEXT_GEN", "Write a blog post");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("openai");
        expect(result.model).toBe("gpt-4o-mini");
        expect(result.providers_attempted).toEqual(["gemini", "openai"]);
      });

      it("should fallback to Claude when Gemini and OpenAI fail", async () => {
        const geminiFailResponse = createFailedResponse("gemini", "gemini-1.5-flash");
        const openaiFailResponse = createFailedResponse("openai", "gpt-4o-mini");
        const claudeSuccessResponse = createSuccessResponse("claude", "claude-3-5-sonnet-20241022");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(geminiFailResponse);
        (OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>).prototype.generate =
          jest.fn().mockResolvedValue(openaiFailResponse);
        (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
          jest.fn().mockResolvedValue(claudeSuccessResponse);

        const result = await router.route("TEXT_GEN", "Write a blog post");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("claude");
        expect(result.providers_attempted).toEqual(["gemini", "openai", "claude"]);
      });
    });

    describe("CODE_GEN task type", () => {
      it("should route to Claude (primary) for CODE_GEN", async () => {
        const mockResponse = createSuccessResponse("claude", "claude-3-5-sonnet-20241022");

        (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
          jest.fn().mockResolvedValue(mockResponse);

        const result = await router.route("CODE_GEN", "Write a sorting function");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("claude");
        expect(result.providers_attempted).toEqual(["claude"]);
      });

      it("should fallback to OpenAI when Claude fails for CODE_GEN", async () => {
        const claudeFailResponse = createFailedResponse("claude", "claude-3-5-sonnet-20241022");
        const openaiSuccessResponse = createSuccessResponse("openai", "gpt-4o");

        (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
          jest.fn().mockResolvedValue(claudeFailResponse);
        (OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>).prototype.generate =
          jest.fn().mockResolvedValue(openaiSuccessResponse);

        const result = await router.route("CODE_GEN", "Write a sorting function");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("openai");
        expect(result.providers_attempted).toEqual(["claude", "openai"]);
      });
    });

    describe("DESIGN_GEN task type", () => {
      it("should route to Gemini Pro (primary) for DESIGN_GEN", async () => {
        const mockResponse = createSuccessResponse("gemini", "gemini-1.5-pro");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(mockResponse);

        const result = await router.route("DESIGN_GEN", "Create a landing page design");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("gemini");
        expect(result.model).toBe("gemini-1.5-pro");
      });
    });

    describe("ECOMMERCE_GEN task type", () => {
      it("should route to Gemini Pro (primary) for ECOMMERCE_GEN", async () => {
        const mockResponse = createSuccessResponse("gemini", "gemini-1.5-pro");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(mockResponse);

        const result = await router.route("ECOMMERCE_GEN", "Generate product descriptions");

        expect(result.success).toBe(true);
        expect(result.provider).toBe("gemini");
      });
    });

    describe("all providers fail", () => {
      it("should return failure when all providers fail", async () => {
        const geminiFailResponse = createFailedResponse("gemini", "gemini-1.5-flash", "Gemini error");
        const openaiFailResponse = createFailedResponse("openai", "gpt-4o-mini", "OpenAI error");
        const claudeFailResponse = createFailedResponse("claude", "claude-3-5-sonnet-20241022", "Claude error");

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(geminiFailResponse);
        (OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>).prototype.generate =
          jest.fn().mockResolvedValue(openaiFailResponse);
        (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
          jest.fn().mockResolvedValue(claudeFailResponse);

        const result = await router.route("TEXT_GEN", "Write something");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Claude error");
        expect(result.error_code).toBe("ALL_PROVIDERS_FAILED");
        expect(result.providers_attempted).toEqual(["gemini", "openai", "claude"]);
      });

      it("should handle provider exceptions", async () => {
        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockRejectedValue(new Error("Network timeout"));
        (OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>).prototype.generate =
          jest.fn().mockRejectedValue(new Error("Connection refused"));
        (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).prototype.generate =
          jest.fn().mockRejectedValue(new Error("Service unavailable"));

        const result = await router.route("TEXT_GEN", "Write something");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Service unavailable");
        expect(result.providers_attempted).toEqual(["gemini", "openai", "claude"]);
      });
    });

    describe("generation options", () => {
      it("should pass options to provider", async () => {
        const mockResponse = createSuccessResponse("gemini", "gemini-1.5-flash");
        const mockGenerate = jest.fn().mockResolvedValue(mockResponse);

        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate = mockGenerate;

        const options = {
          temperature: 0.5,
          max_tokens: 2000,
          system_prompt: "You are a helpful assistant",
        };

        await router.route("TEXT_GEN", "Hello", options);

        expect(mockGenerate).toHaveBeenCalledWith("Hello", options);
      });
    });

    describe("provider caching", () => {
      it("should reuse provider instances for same config", async () => {
        const mockResponse = createSuccessResponse("gemini", "gemini-1.5-flash");
        (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).prototype.generate =
          jest.fn().mockResolvedValue(mockResponse);

        await router.route("TEXT_GEN", "First request");
        await router.route("TEXT_GEN", "Second request");

        // Provider constructor should only be called once for same config
        expect(GeminiProvider).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("getRouteConfig", () => {
    it("should return correct route config for TEXT_GEN", () => {
      const config = router.getRouteConfig("TEXT_GEN");

      expect(config).toHaveLength(3);
      expect(config[0].provider).toBe("gemini");
      expect(config[0].model).toBe("gemini-1.5-flash");
      expect(config[1].provider).toBe("openai");
      expect(config[2].provider).toBe("claude");
    });

    it("should return correct route config for CODE_GEN", () => {
      const config = router.getRouteConfig("CODE_GEN");

      expect(config).toHaveLength(3);
      expect(config[0].provider).toBe("claude");
      expect(config[1].provider).toBe("openai");
      expect(config[2].provider).toBe("gemini");
    });
  });
});

describe("sanitizePrompt", () => {
  it("should remove script tags", () => {
    const input = "Hello <script>alert('xss')</script> world";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello  world");
  });

  it("should remove iframe tags", () => {
    const input = "Hello <iframe src='evil.com'>content</iframe> world";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello  world");
  });

  it("should remove object tags", () => {
    const input = "Hello <object data='evil.swf'>content</object> world";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello  world");
  });

  it("should remove embed tags", () => {
    const input = "Hello <embed src='evil.swf'>content</embed> world";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello  world");
  });

  it("should remove form tags", () => {
    const input = "Hello <form action='evil.com'>content</form> world";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello  world");
  });

  it("should remove event handlers", () => {
    const input = "Hello <div onclick=\"evil()\">click</div>";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello <div data-removed=\"evil()\">click</div>");
  });

  it("should handle multiple malicious elements", () => {
    const input = "<script>bad()</script><iframe>x</iframe>Clean text<form>y</form>";
    const result = sanitizePrompt(input);

    expect(result).toBe("Clean text");
  });

  it("should trim whitespace", () => {
    const input = "  Hello world  ";
    const result = sanitizePrompt(input);

    expect(result).toBe("Hello world");
  });

  it("should preserve safe HTML", () => {
    const input = "<p>Hello</p> <strong>world</strong>";
    const result = sanitizePrompt(input);

    expect(result).toBe("<p>Hello</p> <strong>world</strong>");
  });
});

describe("validatePrompt", () => {
  it("should accept valid prompt", () => {
    const result = validatePrompt("This is a valid prompt");

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject null prompt", () => {
    const result = validatePrompt(null as unknown as string);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt is required and must be a string");
  });

  it("should reject undefined prompt", () => {
    const result = validatePrompt(undefined as unknown as string);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt is required and must be a string");
  });

  it("should reject non-string prompt", () => {
    const result = validatePrompt(123 as unknown as string);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt is required and must be a string");
  });

  it("should reject empty prompt", () => {
    const result = validatePrompt("");

    expect(result.valid).toBe(false);
    // Empty string is falsy, so it triggers the "required" check first
    expect(result.error).toBe("Prompt is required and must be a string");
  });

  it("should reject whitespace-only prompt", () => {
    const result = validatePrompt("   ");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt cannot be empty");
  });

  it("should reject prompt exceeding max length", () => {
    const longPrompt = "a".repeat(10001);
    const result = validatePrompt(longPrompt);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt exceeds maximum length of 10000 characters");
  });

  it("should accept prompt at max length", () => {
    const maxPrompt = "a".repeat(10000);
    const result = validatePrompt(maxPrompt);

    expect(result.valid).toBe(true);
  });

  it("should use custom max length", () => {
    const prompt = "a".repeat(101);
    const result = validatePrompt(prompt, 100);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Prompt exceeds maximum length of 100 characters");
  });
});
