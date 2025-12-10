/**
 * @fileoverview Unit tests for GeminiProvider
 * @module tests/unit/providers/gemini.test
 */

import { GeminiProvider } from '../../../src/providers/gemini';
import { AIProviderError } from '../../../src/types/AIProvider';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
  HarmBlockThreshold: {
    BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  },
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

describe('GeminiProvider', () => {
  let mockGenerateContent: jest.Mock;
  let mockCountTokens: jest.Mock;
  let mockGetGenerativeModel: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock methods
    mockGenerateContent = jest.fn();
    mockCountTokens = jest.fn();
    mockGetGenerativeModel = jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
      countTokens: mockCountTokens,
    });

    (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(
      () =>
        ({
          getGenerativeModel: mockGetGenerativeModel,
        }) as unknown as GoogleGenerativeAI
    );
  });

  describe('constructor', () => {
    it('should throw AIProviderError when API key is empty', () => {
      expect(() => new GeminiProvider('')).toThrow(AIProviderError);
      expect(() => new GeminiProvider('   ')).toThrow(AIProviderError);
    });

    it('should create provider with valid API key', () => {
      const provider = new GeminiProvider('valid-api-key');
      expect(provider).toBeInstanceOf(GeminiProvider);
    });
  });

  describe('default model', () => {
    it('should use the default model from config when no model specified', () => {
      const provider = new GeminiProvider('valid-api-key');

      // Default model should be gemini-2.5-pro-preview-05-06
      expect(provider.getModel()).toBe('gemini-2.5-pro-preview-05-06');
    });

    it('should use custom model when specified', () => {
      const customModel = 'gemini-custom-model';
      const provider = new GeminiProvider('valid-api-key', customModel);

      expect(provider.getModel()).toBe(customModel);
    });

    it('should return correct provider name', () => {
      const provider = new GeminiProvider('valid-api-key');
      expect(provider.getProviderName()).toBe('gemini');
    });
  });

  describe('generate - successful response', () => {
    it('should return content and token usage on successful API call', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key');

      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue('Generated WordPress content'),
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 200,
          },
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      // Act
      const result = await provider.generate('Create a WordPress page about SEO');

      // Assert
      expect(result.success).toBe(true);
      expect(result.provider).toBe('gemini');
      expect(result.content).toBe('Generated WordPress content');
      expect(result.tokens_input).toBe(100);
      expect(result.tokens_output).toBe(200);
      expect(result.total_tokens).toBe(300);
      expect(result.cost_usd).toBeGreaterThan(0);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('should pass temperature and max_tokens to API', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key');

      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue('Content'),
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 100,
          },
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      // Act
      await provider.generate('Test prompt', {
        temperature: 0.5,
        max_tokens: 2000,
        system_prompt: 'You are a helpful assistant',
      });

      // Assert
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            temperature: 0.5,
            maxOutputTokens: 2000,
          }),
          systemInstruction: 'You are a helpful assistant',
        })
      );
    });
  });

  describe('generate - error handling', () => {
    it('should return structured error on network failure', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key', 'gemini-2.5-pro-preview-05-06', {
        maxRetries: 0, // Disable retries for this test
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockGenerateContent.mockRejectedValue(new Error('ECONNREFUSED - network error'));

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
      const provider = new GeminiProvider('valid-api-key', 'gemini-2.5-pro-preview-05-06', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockGenerateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('RATE_LIMITED');
    });

    it('should return INVALID_API_KEY error on 401 response', async () => {
      // Arrange
      const provider = new GeminiProvider('invalid-key', 'gemini-2.5-pro-preview-05-06', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockGenerateContent.mockRejectedValue(new Error('401 UNAUTHENTICATED'));

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('INVALID_API_KEY');
    });

    it('should return CONTENT_FILTERED on safety block', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key', 'gemini-2.5-pro-preview-05-06', {
        maxRetries: 0,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      mockGenerateContent.mockRejectedValue(new Error('Response blocked due to SAFETY'));

      // Act
      const result = await provider.generate('Test prompt');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error_code).toBe('CONTENT_FILTERED');
    });
  });

  describe('countTokens', () => {
    it('should return token count from API', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key');
      mockCountTokens.mockResolvedValue({ totalTokens: 150 });

      // Act
      const count = await provider.countTokens('Test text for token counting');

      // Assert
      expect(count).toBe(150);
    });

    it('should fallback to estimation when API fails', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key');
      mockCountTokens.mockRejectedValue(new Error('API error'));

      const testText = 'This is a test text with about 40 characters';

      // Act
      const count = await provider.countTokens(testText);

      // Assert - fallback uses ~4 chars per token
      expect(count).toBe(Math.ceil(testText.length / 4));
    });
  });

  describe('multimodal support', () => {
    it('should include file attachments in request', async () => {
      // Arrange
      const provider = new GeminiProvider('valid-api-key');

      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue('Image analysis result'),
          usageMetadata: {
            promptTokenCount: 500,
            candidatesTokenCount: 100,
          },
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

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
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Describe this image' }),
          expect.objectContaining({
            inlineData: expect.objectContaining({
              mimeType: 'image/png',
            }),
          }),
        ])
      );
    });
  });
});
