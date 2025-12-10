/**
 * @fileoverview Integration tests for API endpoints
 * @module tests/integration/endpoints.test
 *
 * @description
 * Tests for the main API endpoints using firebase-functions-test.
 * Verifies:
 * - POST /api/auth/validate-license with test license
 * - POST /api/ai/route-request with model and prompt
 */

import { Request } from 'firebase-functions/v2/https';
import { Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { License } from '../../src/types/License';

// Use a generic Request type for testing
type MockRequest = {
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  path: string;
  query: Record<string, unknown>;
  ip: string;
  socket: { remoteAddress: string };
  rawBody: Buffer;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  send: jest.Mock;
};

// Mock firebase-functions/v2/https before any imports
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((options, handler) => handler),
}));

// Mock secrets
jest.mock('../../src/lib/secrets', () => ({
  jwtSecret: { value: () => 'test-jwt-secret' },
  geminiApiKey: { value: () => 'test-gemini-key' },
  claudeApiKey: { value: () => 'test-claude-key' },
}));

// Mock Firestore
jest.mock('../../src/lib/firestore', () => ({
  getLicenseByKey: jest.fn(),
  updateLicense: jest.fn(),
  createAuditLog: jest.fn(),
  isTimestampExpired: jest.fn(),
  timestampToISO: jest.fn(),
  checkAndIncrementRateLimit: jest.fn(),
  incrementTokensUsed: jest.fn(),
  updateCostTracking: jest.fn(),
}));

// Mock JWT
jest.mock('../../src/lib/jwt', () => ({
  generateToken: jest.fn(),
  verifyToken: jest.fn(),
  extractBearerToken: jest.fn(),
  decodeToken: jest.fn(),
  isTokenExpired: jest.fn(),
}));

// Mock Logger
jest.mock('../../src/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  })),
  createRequestLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

// Mock ModelService
jest.mock('../../src/services/modelService', () => ({
  ModelService: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
}));

// Mock aiRouter
jest.mock('../../src/services/aiRouter', () => ({
  sanitizePrompt: jest.fn((prompt) => prompt),
  validatePrompt: jest.fn(() => ({ valid: true })),
}));

// Mock licensing service
jest.mock('../../src/services/licensing', () => ({
  processLicenseValidation: jest.fn(),
}));

// Mock middleware
jest.mock('../../src/middleware/rateLimit', () => ({
  createRateLimitMiddleware: jest.fn(() => jest.fn().mockResolvedValue({ continue: true })),
  getClientIP: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticateRequest: jest.fn(),
  sendAuthErrorResponse: jest.fn((res, result) => {
    res.status(401).json({ success: false, error: result.error, code: result.code });
  }),
}));

import * as firestore from '../../src/lib/firestore';
import { processLicenseValidation } from '../../src/services/licensing';
import { authenticateRequest } from '../../src/middleware/auth';
import { ModelService } from '../../src/services/modelService';

describe('Integration Tests - API Endpoints', () => {
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSetHeader: jest.Mock;
  let mockSend: jest.Mock;

  const createMockLicense = (): License => ({
    license_key: 'CREATOR-2024-ABCDE-FGHIJ',
    site_url: 'https://example.com',
    user_id: 'user_123',
    plan: 'pro',
    tokens_limit: 1000000,
    tokens_used: 100000,
    status: 'active',
    reset_date: Timestamp.fromDate(new Date('2025-12-01')),
    expires_at: Timestamp.fromDate(new Date('2026-01-01')),
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn().mockReturnThis();
    mockSend = jest.fn().mockReturnThis();
    mockSetHeader = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson, send: mockSend });

    mockRequest = {
      method: 'POST',
      body: {},
      headers: {},
      path: '',
      query: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      rawBody: Buffer.from(''),
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      setHeader: mockSetHeader,
      send: mockSend,
    };
  });

  describe('POST /api/auth/validate-license', () => {
    it('should return 200 with site_token for valid license', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        license_key: 'CREATOR-2024-ABCDE-FGHIJ',
        site_url: 'https://example.com',
      };

      (processLicenseValidation as jest.Mock).mockResolvedValue({
        success: true,
        user_id: 'user_123',
        site_token: 'mock-jwt-token',
        plan: 'pro',
        tokens_limit: 1000000,
        tokens_remaining: 900000,
        reset_date: '2025-12-01',
      });

      // Import the handler (which is now the raw function due to our mock)
      const { validateLicense } = await import('../../src/api/auth/validateLicense');

      // Act
      await validateLicense(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          site_token: 'mock-jwt-token',
          plan: 'pro',
        })
      );
    });

    it('should return 400 for missing license_key', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        site_url: 'https://example.com',
      };

      const { validateLicense } = await import('../../src/api/auth/validateLicense');

      // Act
      await validateLicense(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'MISSING_FIELDS',
        })
      );
    });

    it('should return 405 for non-POST method', async () => {
      // Arrange
      mockRequest.method = 'GET';

      const { validateLicense } = await import('../../src/api/auth/validateLicense');

      // Act
      await validateLicense(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(405);
    });

    it('should return 204 for OPTIONS preflight request', async () => {
      // Arrange
      mockRequest.method = 'OPTIONS';

      const { validateLicense } = await import('../../src/api/auth/validateLicense');

      // Act
      await validateLicense(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(204);
    });
  });

  describe('POST /api/ai/route-request', () => {
    const validClaims = {
      license_id: 'CREATOR-2024-ABCDE-FGHIJ',
      site_url: 'https://example.com',
      plan: 'pro' as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
      jti: 'test-jti',
    };

    beforeEach(() => {
      // Setup authentication mock
      (authenticateRequest as jest.Mock).mockResolvedValue({
        authenticated: true,
        claims: validClaims,
      });

      // Setup rate limit mock
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: false,
        count: 1,
      });

      // Setup license mock
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(createMockLicense());
      (firestore.incrementTokensUsed as jest.Mock).mockResolvedValue(undefined);
      (firestore.updateCostTracking as jest.Mock).mockResolvedValue(undefined);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');
    });

    it('should return 200 with generated content for valid request', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Generate a WordPress blog post about SEO',
        model: 'gemini',
      };

      const mockModelService = {
        generate: jest.fn().mockResolvedValue({
          success: true,
          content: 'Generated content about SEO...',
          model: 'gemini',
          model_id: 'gemini-2.5-pro',
          used_fallback: false,
          tokens_input: 100,
          tokens_output: 500,
          total_tokens: 600,
          cost_usd: 0.005,
          latency_ms: 1500,
        }),
      };

      (ModelService as jest.MockedClass<typeof ModelService>).mockImplementation(
        () => mockModelService as unknown as ModelService
      );

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          content: expect.any(String),
          model: 'gemini',
          tokens_used: expect.any(Number),
          cost_usd: expect.any(Number),
        })
      );
    });

    it('should return 401 for missing authorization', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = {};
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Test prompt',
        model: 'gemini',
      };

      (authenticateRequest as jest.Mock).mockResolvedValue({
        authenticated: false,
        error: 'Missing authorization header',
        code: 'MISSING_AUTH',
      });

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(401);
    });

    it('should return 400 for invalid task_type', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'INVALID_TYPE',
        prompt: 'Test prompt',
        model: 'gemini',
      };

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'INVALID_TASK_TYPE',
        })
      );
    });

    it('should return 400 for invalid model', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Test prompt',
        model: 'invalid-model',
      };

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'INVALID_MODEL',
        })
      );
    });

    it('should return 429 when rate limited', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Test prompt',
        model: 'gemini',
      };

      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: true,
        count: 101,
      });

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'RATE_LIMITED',
        })
      );
    });

    it('should return 403 when quota exceeded', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Test prompt',
        model: 'gemini',
      };

      const exhaustedLicense = createMockLicense();
      exhaustedLicense.tokens_used = exhaustedLicense.tokens_limit;
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(exhaustedLicense);

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'QUOTA_EXCEEDED',
        })
      );
    });

    it('should return 503 when all models fail', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.headers = { authorization: 'Bearer valid-token' };
      mockRequest.body = {
        task_type: 'TEXT_GEN',
        prompt: 'Test prompt',
        model: 'gemini',
      };

      const mockModelService = {
        generate: jest.fn().mockResolvedValue({
          success: false,
          content: '',
          model: 'gemini',
          model_id: 'gemini-2.5-pro',
          used_fallback: true,
          tokens_input: 0,
          tokens_output: 0,
          total_tokens: 0,
          cost_usd: 0,
          latency_ms: 5000,
          error: 'All models failed',
          error_code: 'ALL_MODELS_FAILED',
        }),
      };

      (ModelService as jest.MockedClass<typeof ModelService>).mockImplementation(
        () => mockModelService as unknown as ModelService
      );

      const { routeRequest } = await import('../../src/api/ai/routeRequest');

      // Act
      await routeRequest(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(503);
    });
  });
});
