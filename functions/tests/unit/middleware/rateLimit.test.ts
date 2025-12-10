/**
 * @fileoverview Unit tests for Rate Limit Middleware
 * @module tests/unit/middleware/rateLimit.test
 */

import { Request, Response } from 'express';
import {
  checkRateLimit,
  checkRateLimitByLicense,
  checkRateLimitInMemory,
  sendRateLimitResponse,
  createRateLimitMiddleware,
  createLicenseRateLimitMiddleware,
  getClientIP,
  buildRateLimitKey,
  clearInMemoryCounters,
  getCounterCount,
  stopCleanupInterval,
  startCleanupInterval,
  getRateLimitStrategy,
  RateLimitStrategy,
} from '../../../src/middleware/rateLimit';
import { Logger } from '../../../src/lib/logger';
import * as firestore from '../../../src/lib/firestore';

// Mock dependencies
jest.mock('../../../src/lib/firestore', () => ({
  checkAndIncrementRateLimit: jest.fn(),
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

describe('Rate Limit Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockLogger: Logger;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSetHeader: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryCounters();

    mockJson = jest.fn().mockReturnThis();
    mockSetHeader = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      headers: {},
      socket: { remoteAddress: '192.168.1.1' } as unknown as Request['socket'],
      ip: '192.168.1.1',
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      setHeader: mockSetHeader,
    };

    mockLogger = new Logger();
  });

  afterAll(() => {
    stopCleanupInterval();
  });

  describe('getClientIP', () => {
    it('should extract IP from X-Forwarded-For header', () => {
      mockRequest.headers = {
        'x-forwarded-for': '203.0.113.50, 70.41.3.18',
      };

      const ip = getClientIP(mockRequest as Request);
      expect(ip).toBe('203.0.113.50');
    });

    it('should extract IP from X-Real-IP header', () => {
      mockRequest.headers = {
        'x-real-ip': '203.0.113.75',
      };

      const ip = getClientIP(mockRequest as Request);
      expect(ip).toBe('203.0.113.75');
    });

    it('should fallback to socket remoteAddress', () => {
      mockRequest.headers = {};
      mockRequest.socket = { remoteAddress: '10.0.0.1' } as unknown as Request['socket'];

      const ip = getClientIP(mockRequest as Request);
      expect(ip).toBe('10.0.0.1');
    });

    it('should fallback to req.ip', () => {
      // Create a fresh request object with ip set
      const requestWithIp = {
        headers: {},
        socket: undefined,
        ip: '127.0.0.1',
      } as unknown as Request;

      const ip = getClientIP(requestWithIp);
      expect(ip).toBe('127.0.0.1');
    });
  });

  describe('buildRateLimitKey', () => {
    it('should build key from identifier and endpoint', () => {
      const key = buildRateLimitKey('license_123', 'route_request');
      expect(key).toBe('license_123:route_request');
    });

    it('should build key from IP and endpoint', () => {
      const key = buildRateLimitKey('192.168.1.1', 'validate_license');
      expect(key).toBe('192.168.1.1:validate_license');
    });
  });

  describe('checkRateLimitInMemory', () => {
    beforeEach(() => {
      clearInMemoryCounters();
    });

    it('should allow first request and set count to 1', () => {
      const result = checkRateLimitInMemory('test:endpoint', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
      expect(result.resetIn).toBe(60);
    });

    it('should increment counter for subsequent requests', () => {
      checkRateLimitInMemory('test:endpoint', 10, 60);
      const result = checkRateLimitInMemory('test:endpoint', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(2);
    });

    it('should deny request when limit is reached', () => {
      const key = 'test:endpoint';

      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        checkRateLimitInMemory(key, 10, 60);
      }

      // 11th request should be denied
      const result = checkRateLimitInMemory(key, 10, 60);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(10);
    });

    it('should reset counter after window expires', () => {
      jest.useFakeTimers();

      const key = 'test:endpoint';

      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        checkRateLimitInMemory(key, 10, 60);
      }

      // Verify we're rate limited
      let result = checkRateLimitInMemory(key, 10, 60);
      expect(result.allowed).toBe(false);

      // Advance time past the window
      jest.advanceTimersByTime(61 * 1000);

      // Should be allowed again with reset counter
      result = checkRateLimitInMemory(key, 10, 60);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);

      jest.useRealTimers();
    });

    it('should track separate keys independently', () => {
      checkRateLimitInMemory('user1:endpoint', 2, 60);
      checkRateLimitInMemory('user1:endpoint', 2, 60);
      checkRateLimitInMemory('user2:endpoint', 2, 60);

      // user1 should be at limit
      const result1 = checkRateLimitInMemory('user1:endpoint', 2, 60);
      expect(result1.allowed).toBe(false);

      // user2 should still have room
      const result2 = checkRateLimitInMemory('user2:endpoint', 2, 60);
      expect(result2.allowed).toBe(true);
      expect(result2.count).toBe(2);
    });
  });

  describe('getRateLimitStrategy', () => {
    const originalEnv = process.env.RATE_LIMIT_STRATEGY;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.RATE_LIMIT_STRATEGY;
      } else {
        process.env.RATE_LIMIT_STRATEGY = originalEnv;
      }
    });

    it('should return MEMORY as default strategy', () => {
      delete process.env.RATE_LIMIT_STRATEGY;
      expect(getRateLimitStrategy()).toBe(RateLimitStrategy.MEMORY);
    });

    it('should return FIRESTORE when configured', () => {
      process.env.RATE_LIMIT_STRATEGY = 'firestore';
      expect(getRateLimitStrategy()).toBe(RateLimitStrategy.FIRESTORE);
    });

    it('should return REDIS when configured', () => {
      process.env.RATE_LIMIT_STRATEGY = 'redis';
      expect(getRateLimitStrategy()).toBe(RateLimitStrategy.REDIS);
    });

    it('should be case-insensitive', () => {
      process.env.RATE_LIMIT_STRATEGY = 'FIRESTORE';
      expect(getRateLimitStrategy()).toBe(RateLimitStrategy.FIRESTORE);
    });
  });

  describe('checkRateLimit (with Firestore strategy)', () => {
    const rateLimitConfig = {
      maxRequests: 10,
      endpoint: 'test_endpoint',
      strategy: RateLimitStrategy.FIRESTORE,
    };

    it('should allow request when under rate limit threshold', async () => {
      // Arrange
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: false,
        count: 5, // Under limit of 10
      });

      // Act
      const result = await checkRateLimit(
        mockRequest as Request,
        rateLimitConfig,
        mockLogger
      );

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(5);
    });

    it('should deny request when over rate limit threshold', async () => {
      // Arrange
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: true,
        count: 11, // Over limit of 10
      });

      // Act
      const result = await checkRateLimit(
        mockRequest as Request,
        rateLimitConfig,
        mockLogger
      );

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.count).toBe(11);
    });

    it('should fail open when rate limit check throws error', async () => {
      // Arrange
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockRejectedValue(
        new Error('Firestore error')
      );

      // Act
      const result = await checkRateLimit(
        mockRequest as Request,
        rateLimitConfig,
        mockLogger
      );

      // Assert - Fail open: allow request
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(0);
    });
  });

  describe('checkRateLimit (with Memory strategy)', () => {
    beforeEach(() => {
      clearInMemoryCounters();
    });

    it('should use in-memory rate limiting when strategy is MEMORY', async () => {
      const config = {
        maxRequests: 5,
        endpoint: 'test_endpoint',
        strategy: RateLimitStrategy.MEMORY,
      };

      // First request should be allowed
      const result1 = await checkRateLimit(mockRequest as Request, config, mockLogger);
      expect(result1.allowed).toBe(true);
      expect(result1.count).toBe(1);

      // Firestore should NOT be called
      expect(firestore.checkAndIncrementRateLimit).not.toHaveBeenCalled();
    });

    it('should properly rate limit with in-memory strategy', async () => {
      const config = {
        maxRequests: 2,
        endpoint: 'test_memory',
        strategy: RateLimitStrategy.MEMORY,
      };

      // Make requests up to the limit
      await checkRateLimit(mockRequest as Request, config, mockLogger);
      await checkRateLimit(mockRequest as Request, config, mockLogger);

      // Third request should be denied
      const result = await checkRateLimit(mockRequest as Request, config, mockLogger);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkRateLimitByLicense', () => {
    beforeEach(() => {
      clearInMemoryCounters();
    });

    it('should rate limit by license_id', async () => {
      const config = {
        maxRequests: 3,
        endpoint: 'route_request',
        strategy: RateLimitStrategy.MEMORY,
      };

      // Make requests for license A
      await checkRateLimitByLicense('license_A', config, mockLogger);
      await checkRateLimitByLicense('license_A', config, mockLogger);
      await checkRateLimitByLicense('license_A', config, mockLogger);

      // License A should be rate limited
      const resultA = await checkRateLimitByLicense('license_A', config, mockLogger);
      expect(resultA.allowed).toBe(false);

      // License B should still be allowed
      const resultB = await checkRateLimitByLicense('license_B', config, mockLogger);
      expect(resultB.allowed).toBe(true);
    });
  });

  describe('sendRateLimitResponse', () => {
    it('should send 429 status with rate limit headers', () => {
      // Act
      sendRateLimitResponse(mockResponse as Response, 60);

      // Assert
      expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', '60');
      expect(mockSetHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(String)
      );
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        error: expect.any(String),
        code: 'RATE_LIMITED',
      });
    });

    it('should default retry after to 60 seconds', () => {
      // Act
      sendRateLimitResponse(mockResponse as Response);

      // Assert
      expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', '60');
    });
  });

  describe('createRateLimitMiddleware', () => {
    beforeEach(() => {
      clearInMemoryCounters();
    });

    it('should return continue: true when under rate limit', async () => {
      // Arrange
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: false,
        count: 3,
      });

      const middleware = createRateLimitMiddleware({
        maxRequests: 10,
        endpoint: 'test',
        strategy: RateLimitStrategy.FIRESTORE,
      });

      // Act
      const result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );

      // Assert
      expect(result.continue).toBe(true);
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '7');
    });

    it('should return continue: false and send 429 when over rate limit', async () => {
      // Arrange
      (firestore.checkAndIncrementRateLimit as jest.Mock).mockResolvedValue({
        limited: true,
        count: 15,
      });

      const middleware = createRateLimitMiddleware({
        maxRequests: 10,
        endpoint: 'test',
        strategy: RateLimitStrategy.FIRESTORE,
      });

      // Act
      const result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );

      // Assert
      expect(result.continue).toBe(false);
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
    });

    it('should work with in-memory strategy', async () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 2,
        endpoint: 'test_memory',
        strategy: RateLimitStrategy.MEMORY,
      });

      // First two requests should pass
      let result = await middleware(mockRequest as Request, mockResponse as Response, mockLogger);
      expect(result.continue).toBe(true);

      result = await middleware(mockRequest as Request, mockResponse as Response, mockLogger);
      expect(result.continue).toBe(true);

      // Third request should be rate limited
      result = await middleware(mockRequest as Request, mockResponse as Response, mockLogger);
      expect(result.continue).toBe(false);
      expect(mockStatus).toHaveBeenCalledWith(429);
    });
  });

  describe('createLicenseRateLimitMiddleware', () => {
    beforeEach(() => {
      clearInMemoryCounters();
    });

    it('should rate limit by license_id', async () => {
      const middleware = createLicenseRateLimitMiddleware({
        maxRequests: 2,
        endpoint: 'route_request',
        strategy: RateLimitStrategy.MEMORY,
      });

      // First two requests for license should pass
      let result = await middleware('license_123', mockResponse as Response, mockLogger);
      expect(result.continue).toBe(true);

      result = await middleware('license_123', mockResponse as Response, mockLogger);
      expect(result.continue).toBe(true);

      // Third request should be rate limited
      result = await middleware('license_123', mockResponse as Response, mockLogger);
      expect(result.continue).toBe(false);
    });

    it('should allow different licenses independently', async () => {
      const middleware = createLicenseRateLimitMiddleware({
        maxRequests: 1,
        endpoint: 'route_request',
        strategy: RateLimitStrategy.MEMORY,
      });

      // Exhaust rate limit for license_A
      await middleware('license_A', mockResponse as Response, mockLogger);
      const resultA = await middleware('license_A', mockResponse as Response, mockLogger);
      expect(resultA.continue).toBe(false);

      // license_B should still be allowed
      const resultB = await middleware('license_B', mockResponse as Response, mockLogger);
      expect(resultB.continue).toBe(true);
    });
  });

  describe('cleanup functions', () => {
    it('should clear all counters with clearInMemoryCounters', () => {
      checkRateLimitInMemory('test1:endpoint', 10, 60);
      checkRateLimitInMemory('test2:endpoint', 10, 60);

      expect(getCounterCount('test1:endpoint')).toBe(1);
      expect(getCounterCount('test2:endpoint')).toBe(1);

      clearInMemoryCounters();

      expect(getCounterCount('test1:endpoint')).toBe(0);
      expect(getCounterCount('test2:endpoint')).toBe(0);
    });

    it('should start and stop cleanup interval', () => {
      // Stop any existing interval
      stopCleanupInterval();

      // Start a new one
      startCleanupInterval();

      // Starting again should be a no-op
      startCleanupInterval();

      // Stop it
      stopCleanupInterval();
    });
  });

  describe('rate limit window reset', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      clearInMemoryCounters();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should allow requests after rate limit window resets (in-memory)', async () => {
      const middleware = createRateLimitMiddleware({
        maxRequests: 2,
        windowSeconds: 60,
        endpoint: 'test',
        strategy: RateLimitStrategy.MEMORY,
      });

      // First request - allowed
      let result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );
      expect(result.continue).toBe(true);

      // Second request - allowed
      result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );
      expect(result.continue).toBe(true);

      // Third request - rate limited
      result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );
      expect(result.continue).toBe(false);

      // Advance time by 61 seconds (past the 60-second window)
      jest.advanceTimersByTime(61000);

      // Fourth request after window reset - allowed
      result = await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockLogger
      );
      expect(result.continue).toBe(true);
    });

    it('should provide resetIn in the result', () => {
      const result = checkRateLimitInMemory('test:endpoint', 10, 60);
      expect(result.resetIn).toBeDefined();
      expect(result.resetIn).toBeGreaterThan(0);
      expect(result.resetIn).toBeLessThanOrEqual(60);
    });
  });
});
