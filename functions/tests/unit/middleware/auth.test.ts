/**
 * @fileoverview Unit tests for Auth Middleware
 * @module tests/unit/middleware/auth.test
 */

import { Request, Response } from 'express';
import {
  authenticateRequest,
  sendAuthErrorResponse,
  createAuthMiddleware,
} from '../../../src/middleware/auth';
import { Logger } from '../../../src/lib/logger';
import * as jwt from '../../../src/lib/jwt';
import * as firestore from '../../../src/lib/firestore';
import { License } from '../../../src/types/License';
import { Timestamp } from 'firebase-admin/firestore';

// Mock dependencies
jest.mock('../../../src/lib/jwt', () => ({
  extractBearerToken: jest.fn(),
  verifyToken: jest.fn(),
}));

jest.mock('../../../src/lib/firestore', () => ({
  getLicenseByKey: jest.fn(),
}));

jest.mock('../../../src/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  })),
}));

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockLogger: Logger;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  const validClaims = {
    license_id: 'CREATOR-2024-ABCDE-FGHIJ',
    site_url: 'https://example.com',
    plan: 'pro' as const,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    jti: 'test-jti-123',
  };

  const createMockLicense = (overrides: Partial<License> = {}): License => ({
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
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      headers: {
        authorization: 'Bearer valid-token',
      },
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };

    mockLogger = new Logger();
  });

  describe('authenticateRequest', () => {
    it('should authenticate successfully with valid token and active license', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(createMockLicense());

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(true);
      expect(result.claims).toEqual(validClaims);
      expect(result.error).toBeUndefined();
    });

    it('should return 401 error when token is missing', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue(null);

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('MISSING_AUTH');
      expect(result.error).toContain('Missing or invalid Authorization header');
    });

    it('should return 401 error when token is invalid/expired', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('expired-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: false,
        error: 'Token has expired',
      });

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('INVALID_TOKEN');
      expect(result.error).toContain('expired');
    });

    it('should return 403 error when license is suspended', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(
        createMockLicense({ status: 'suspended' })
      );

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('LICENSE_SUSPENDED');
      expect(result.error).toContain('suspended');
    });

    it('should return 403 error when license is expired', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(
        createMockLicense({ status: 'expired' })
      );

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('LICENSE_EXPIRED');
      expect(result.error).toContain('expired');
    });

    it('should return error when license not found', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('LICENSE_NOT_FOUND');
    });

    it('should return error when site URL does not match', async () => {
      // Arrange
      const claimsWithDifferentUrl = {
        ...validClaims,
        site_url: 'https://different-site.com',
      };

      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: claimsWithDifferentUrl,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(createMockLicense());

      // Act
      const result = await authenticateRequest(
        mockRequest as Request,
        'test-jwt-secret',
        mockLogger
      );

      // Assert
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe('URL_MISMATCH');
    });
  });

  describe('sendAuthErrorResponse', () => {
    it('should send 401 status for MISSING_AUTH error', () => {
      // Arrange
      const authResult = {
        authenticated: false,
        error: 'Missing authorization header',
        code: 'MISSING_AUTH',
      };

      // Act
      sendAuthErrorResponse(mockResponse as Response, authResult);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        error: 'Missing authorization header',
        code: 'MISSING_AUTH',
      });
    });

    it('should send 403 status for LICENSE_SUSPENDED error', () => {
      // Arrange
      const authResult = {
        authenticated: false,
        error: 'License is suspended',
        code: 'LICENSE_SUSPENDED',
      };

      // Act
      sendAuthErrorResponse(mockResponse as Response, authResult);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        error: 'License is suspended',
        code: 'LICENSE_SUSPENDED',
      });
    });
  });

  describe('createAuthMiddleware', () => {
    it('should return continue: true with claims for valid authentication', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(createMockLicense());

      const middleware = createAuthMiddleware('test-jwt-secret');

      // Act
      const result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );

      // Assert
      expect(result.continue).toBe(true);
      expect(result.claims).toEqual(validClaims);
    });

    it('should return continue: false and send error response for invalid token', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue(null);

      const middleware = createAuthMiddleware('test-jwt-secret');

      // Act
      const result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );

      // Assert
      expect(result.continue).toBe(false);
      expect(result.claims).toBeUndefined();
      expect(mockStatus).toHaveBeenCalledWith(401);
    });

    it('should return continue: false and send 403 for suspended license', async () => {
      // Arrange
      (jwt.extractBearerToken as jest.Mock).mockReturnValue('valid-token');
      (jwt.verifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: validClaims,
      });
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(
        createMockLicense({ status: 'suspended' })
      );

      const middleware = createAuthMiddleware('test-jwt-secret');

      // Act
      const result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );

      // Assert
      expect(result.continue).toBe(false);
      expect(mockStatus).toHaveBeenCalledWith(403);
    });
  });
});
