/**
 * @fileoverview Unit tests for ModelService
 * @module tests/unit/services/modelService.test
 */

import { ModelService, ModelServiceKeys } from '../../../src/services/modelService';
import { GeminiProvider } from '../../../src/providers/gemini';
import { ClaudeProvider } from '../../../src/providers/claude';
import { Logger } from '../../../src/lib/logger';
import { ModelRequest } from '../../../src/types/ModelConfig';

// Mock the providers
jest.mock('../../../src/providers/gemini');
jest.mock('../../../src/providers/claude');

// Mock the Logger
jest.mock('../../../src/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  })),
}));

describe('ModelService', () => {
  let modelService: ModelService;
  let mockGeminiProvider: jest.Mocked<GeminiProvider>;
  let mockClaudeProvider: jest.Mocked<ClaudeProvider>;
  let mockLogger: Logger;

  const testKeys: ModelServiceKeys = {
    gemini: 'test-gemini-key',
    claude: 'test-claude-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Gemini provider
    mockGeminiProvider = {
      generate: jest.fn(),
      countTokens: jest.fn().mockResolvedValue(100),
      getModel: jest.fn().mockReturnValue('gemini-2.5-pro'),
      getProviderName: jest.fn().mockReturnValue('gemini'),
    } as unknown as jest.Mocked<GeminiProvider>;

    // Setup mock Claude provider
    mockClaudeProvider = {
      generate: jest.fn(),
      countTokens: jest.fn().mockResolvedValue(100),
      getModel: jest.fn().mockReturnValue('claude-opus-4-5-20251101'),
      getProviderName: jest.fn().mockReturnValue('claude'),
    } as unknown as jest.Mocked<ClaudeProvider>;

    // Mock constructor implementations
    (GeminiProvider as jest.MockedClass<typeof GeminiProvider>).mockImplementation(
      () => mockGeminiProvider
    );
    (ClaudeProvider as jest.MockedClass<typeof ClaudeProvider>).mockImplementation(
      () => mockClaudeProvider
    );

    mockLogger = new Logger();
    modelService = new ModelService(testKeys, mockLogger);
  });

  describe('generate with model selection', () => {
    const successResponse = {
      success: true,
      provider: 'gemini' as const,
      model: 'gemini-2.5-pro',
      content: 'Generated content',
      tokens_input: 50,
      tokens_output: 100,
      total_tokens: 150,
      cost_usd: 0.001,
      latency_ms: 500,
    };

    it('should use Gemini provider when model is "gemini" without fallback', async () => {
      // Arrange
      mockGeminiProvider.generate.mockResolvedValue(successResponse);

      const request: ModelRequest = {
        model: 'gemini',
        prompt: 'Test prompt',
      };

      // Act
      const result = await modelService.generate(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.model).toBe('gemini');
      expect(GeminiProvider).toHaveBeenCalledWith(testKeys.gemini, expect.any(String));
      expect(mockGeminiProvider.generate).toHaveBeenCalled();
      expect(mockClaudeProvider.generate).not.toHaveBeenCalled();
    });

    it('should use Claude provider when model is "claude" without fallback', async () => {
      // Arrange
      const claudeSuccessResponse = {
        ...successResponse,
        provider: 'claude' as const,
        model: 'claude-opus-4-5-20251101',
      };
      mockClaudeProvider.generate.mockResolvedValue(claudeSuccessResponse);

      const request: ModelRequest = {
        model: 'claude',
        prompt: 'Test prompt',
      };

      // Act
      const result = await modelService.generate(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.model).toBe('claude');
      expect(ClaudeProvider).toHaveBeenCalledWith(testKeys.claude, expect.any(String));
      expect(mockClaudeProvider.generate).toHaveBeenCalled();
      expect(mockGeminiProvider.generate).not.toHaveBeenCalled();
    });
  });

  describe('fallback behavior', () => {
    it('should call fallback provider when primary fails', async () => {
      // Arrange - Gemini fails, Claude succeeds
      const failureResponse = {
        success: false,
        provider: 'gemini' as const,
        model: 'gemini-2.5-pro',
        content: '',
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: 100,
        error: 'Network error',
        error_code: 'NETWORK_ERROR',
      };

      const fallbackSuccessResponse = {
        success: true,
        provider: 'claude' as const,
        model: 'claude-opus-4-5-20251101',
        content: 'Fallback content',
        tokens_input: 50,
        tokens_output: 100,
        total_tokens: 150,
        cost_usd: 0.002,
        latency_ms: 600,
      };

      mockGeminiProvider.generate.mockResolvedValue(failureResponse);
      mockClaudeProvider.generate.mockResolvedValue(fallbackSuccessResponse);

      const request: ModelRequest = {
        model: 'gemini',
        prompt: 'Test prompt',
      };

      // Act
      const result = await modelService.generate(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(true);
      expect(mockGeminiProvider.generate).toHaveBeenCalled();
      expect(mockClaudeProvider.generate).toHaveBeenCalled();
    });

    it('should return error when both primary and fallback fail', async () => {
      // Arrange - Both providers fail
      const geminiFailure = {
        success: false,
        provider: 'gemini' as const,
        model: 'gemini-2.5-pro',
        content: '',
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: 100,
        error: 'Gemini error',
        error_code: 'PROVIDER_ERROR',
      };

      const claudeFailure = {
        success: false,
        provider: 'claude' as const,
        model: 'claude-opus-4-5-20251101',
        content: '',
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: 100,
        error: 'Claude error',
        error_code: 'PROVIDER_ERROR',
      };

      mockGeminiProvider.generate.mockResolvedValue(geminiFailure);
      mockClaudeProvider.generate.mockResolvedValue(claudeFailure);

      const request: ModelRequest = {
        model: 'gemini',
        prompt: 'Test prompt',
      };

      // Act
      const result = await modelService.generate(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.used_fallback).toBe(true);
      expect(result.error).toContain('Both models failed');
      expect(result.error_code).toBe('ALL_MODELS_FAILED');
    });
  });

  describe('parameter propagation', () => {
    it('should correctly propagate prompt, system_prompt, temperature, and max_tokens', async () => {
      // Arrange
      const successResponse = {
        success: true,
        provider: 'gemini' as const,
        model: 'gemini-2.5-pro',
        content: 'Response',
        tokens_input: 50,
        tokens_output: 100,
        total_tokens: 150,
        cost_usd: 0.001,
        latency_ms: 500,
      };

      mockGeminiProvider.generate.mockResolvedValue(successResponse);

      const request: ModelRequest = {
        model: 'gemini',
        prompt: 'Generate WordPress content',
        system_prompt: 'You are a WordPress expert',
        temperature: 0.5,
        max_tokens: 4000,
        context: { site_name: 'TestSite' },
      };

      // Act
      await modelService.generate(request);

      // Assert
      expect(mockGeminiProvider.generate).toHaveBeenCalledWith(
        'Generate WordPress content',
        expect.objectContaining({
          temperature: 0.5,
          max_tokens: 4000,
          system_prompt: 'You are a WordPress expert',
        })
      );
    });

    it('should use default values when optional parameters are not provided', async () => {
      // Arrange
      const successResponse = {
        success: true,
        provider: 'gemini' as const,
        model: 'gemini-2.5-pro',
        content: 'Response',
        tokens_input: 50,
        tokens_output: 100,
        total_tokens: 150,
        cost_usd: 0.001,
        latency_ms: 500,
      };

      mockGeminiProvider.generate.mockResolvedValue(successResponse);

      const request: ModelRequest = {
        model: 'gemini',
        prompt: 'Simple prompt',
      };

      // Act
      await modelService.generate(request);

      // Assert
      expect(mockGeminiProvider.generate).toHaveBeenCalledWith(
        'Simple prompt',
        expect.objectContaining({
          temperature: 0.7, // default
          max_tokens: 8000, // default
        })
      );
    });
  });
});
