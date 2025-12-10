/**
 * @fileoverview Unit tests for ClaudeProvider
 * @module tests/unit/providers/claude.test
 */

import { ClaudeProvider } from '../../../src/providers/claude';
import { AIProviderError } from '../../../src/types/AIProvider';

// Store mock reference for use in tests
let mockCreate: jest.Mock;

jest.mock('@anthropic-ai/sdk', () => {
  // Create a mock APIError class that can be used for instanceof checks
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  // Create the mock function
  const create = jest.fn();

  // Expose it for tests
  (global as Record<string, unknown>).__mockAnthropicCreate = create;

  // Create the mock Anthropic constructor with APIError as a static property
  const MockAnthropicClass = jest.fn().mockImplementation(() => ({
    messages: {
      create,
    },
  }));

  // Attach APIError as a static property (this is how the real SDK exports it)
  (MockAnthropicClass as unknown as { APIError: typeof MockAPIError }).APIError = MockAPIError;

  return {
    __esModule: true,
    default: MockAnthropicClass,
    APIError: MockAPIError,
  };
});

// Mock tiktoken
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn().mockReturnValue({
    encode: jest.fn().mockReturnValue([1, 2, 3, 4, 5]), // 5 tokens
    free: jest.fn(),
  }),
}));

// Mock Logger
jest.mock('../../../src/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  })),
}));

describe('ClaudeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Get the mock create function from global
    mockCreate = (global as Record<string, unknown>).__mockAnthropicCreate as jest.Mock;
    mockCreate.mockReset();
  });

  describe('constructor', () => {
    it('should throw AIProviderError when API key is empty', () => {
      expect(() => new ClaudeProvider('')).toThrow(AIProviderError);
      expect(() => new ClaudeProvider('   ')).toThrow(AIProviderError);
    });

    it('should create provider with valid API key', () => {
      const provider = new ClaudeProvider('valid-api-key');
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });
  });

  describe('default model', () => {
    it('should use the default model from config when no model specified', () => {
      const provider = new ClaudeProvider('valid-api-key');

      // Default model should be claude-opus-4-5-20251101
      expect(provider.getModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should use custom model when specified', () => {
      const customModel = 'claude-custom-model';
      const provider = new ClaudeProvider('valid-api-key', customModel);

      expect(provider.getModel()).toBe(customModel);
    });

    it('should return correct provider name', () => {
      const provider = new ClaudeProvider('valid-api-key');
      expect(provider.getProviderName()).toBe('claude');
    });
  });

  describe('generate - successful response', () => {
    it('should return content and token usage on successful API call', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key');

      const mockResponse = {
        content: [{ type: 'text', text: 'Generated WordPress content' }],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
        stop_reason: 'end_turn',
      };

      mockCreate.mockResolvedValue(mockResponse);

      // Act
      const result = await provider.generate('Create a WordPress page about SEO');

      // Assert
      expect(result.success).toBe(true);
      expect(result.provider).toBe('claude');
      expect(result.content).toBe('Generated WordPress content');
      expect(result.tokens_input).toBe(100);
      expect(result.tokens_output).toBe(200);
      expect(result.total_tokens).toBe(300);
      expect(result.cost_usd).toBeGreaterThan(0);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('should pass temperature, max_tokens, and system_prompt to API', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key');

      const mockResponse = {
        content: [{ type: 'text', text: 'Content' }],
        usage: {
          input_tokens: 50,
          output_tokens: 100,
        },
        stop_reason: 'end_turn',
      };

      mockCreate.mockResolvedValue(mockResponse);

      // Act
      await provider.generate('Test prompt', {
        temperature: 0.5,
        max_tokens: 2000,
        system_prompt: 'You are a WordPress expert',
      });

      // Assert
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-5-20251101',
          temperature: 0.5,
          max_tokens: 2000,
          system: 'You are a WordPress expert',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Test prompt',
            }),
          ]),
        })
      );
    });
  });

  describe('generate - error handling', () => {
    it('should return structured error on network failure', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key', 'claude-opus-4-5-20251101', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockCreate.mockRejectedValue(new Error('ECONNREFUSED - network error'));

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.error_code).toBe('NETWORK_ERROR');
      expect(result.content).toBe('');
    });

    it('should return RATE_LIMITED error on 429 response', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key', 'claude-opus-4-5-20251101', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      // Create Error with status property
      const apiError = Object.assign(new Error('Rate limited'), { status: 429 });
      mockCreate.mockRejectedValue(apiError);

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('RATE_LIMITED');
    });

    it('should return INVALID_API_KEY error on 401 response', async () => {
      // Arrange
      const provider = new ClaudeProvider('invalid-key', 'claude-opus-4-5-20251101', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      // Create Error with status property
      const apiError = Object.assign(new Error('Unauthorized'), { status: 401 });
      mockCreate.mockRejectedValue(apiError);

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('INVALID_API_KEY');
    });

    it('should return PROVIDER_ERROR on 500 response', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key', 'claude-opus-4-5-20251101', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      // Create Error with status property
      const apiError = Object.assign(new Error('Internal server error'), { status: 500 });
      mockCreate.mockRejectedValue(apiError);

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('PROVIDER_ERROR');
    });

    it('should return TIMEOUT error on timeout', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key', 'claude-opus-4-5-20251101', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockCreate.mockRejectedValue(new Error('Request timeout'));

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('TIMEOUT');
    });
  });

  describe('countTokens', () => {
    it('should return token count from tiktoken', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key');

      // Act
      const count = await provider.countTokens('Test text for token counting');

      // Assert - mock returns array of 5 tokens
      expect(count).toBe(5);
    });
  });

  describe('multimodal support', () => {
    it('should include image attachments in request', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key');

      const mockResponse = {
        content: [{ type: 'text', text: 'Image analysis result' }],
        usage: {
          input_tokens: 500,
          output_tokens: 100,
        },
        stop_reason: 'end_turn',
      };

      mockCreate.mockResolvedValue(mockResponse);

      const files = [
        {
          name: 'screenshot.png',
          type: 'image/png',
          size: 1024,
          base64: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ];

      // Act
      const result = await provider.generate('Describe this image', { files });

      // Assert
      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image',
                  source: expect.objectContaining({
                    type: 'base64',
                    media_type: 'image/png',
                  }),
                }),
                expect.objectContaining({
                  type: 'text',
                  text: 'Describe this image',
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should skip unsupported file types', async () => {
      // Arrange
      const provider = new ClaudeProvider('valid-api-key');

      const mockResponse = {
        content: [{ type: 'text', text: 'Response without PDF' }],
        usage: {
          input_tokens: 50,
          output_tokens: 50,
        },
        stop_reason: 'end_turn',
      };

      mockCreate.mockResolvedValue(mockResponse);

      const files = [
        {
          name: 'document.pdf',
          type: 'application/pdf', // PDF not supported by Claude
          size: 2048,
          base64: 'JVBERi0xLjQ=',
        },
      ];

      // Act
      const result = await provider.generate('Describe this document', { files });

      // Assert
      expect(result.success).toBe(true);
      // Should be called with just text (no file attachments)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: 'Describe this document',
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });
});
