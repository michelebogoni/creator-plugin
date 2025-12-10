/**
 * @fileoverview Unit tests for Licensing Service
 * @module tests/unit/services/licensing.test
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  validateLicenseKeyFormat,
  validateSiteUrlFormat,
  validateLicenseState,
  processLicenseValidation,
} from '../../../src/services/licensing';
import { License } from '../../../src/types/License';
import { Logger } from '../../../src/lib/logger';
import * as firestore from '../../../src/lib/firestore';
import * as jwt from '../../../src/lib/jwt';

// Mock Firestore operations
jest.mock('../../../src/lib/firestore', () => ({
  getLicenseByKey: jest.fn(),
  updateLicense: jest.fn(),
  createAuditLog: jest.fn(),
  isTimestampExpired: jest.fn(),
  timestampToISO: jest.fn(),
}));

// Mock JWT operations
jest.mock('../../../src/lib/jwt', () => ({
  generateToken: jest.fn(),
  decodeToken: jest.fn(),
  isTokenExpired: jest.fn(),
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

describe('Licensing Service', () => {
  const mockLogger = new Logger() as jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateLicenseKeyFormat', () => {
    it('should return valid for correct format', () => {
      const result = validateLicenseKeyFormat('CREATOR-2024-ABCDE-FGHIJ');
      expect(result.valid).toBe(true);
    });

    it('should return invalid for incorrect format', () => {
      const result = validateLicenseKeyFormat('INVALID-KEY');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_FORMAT');
    });

    it('should return invalid for empty string', () => {
      const result = validateLicenseKeyFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('License key is required');
    });
  });

  describe('validateSiteUrlFormat', () => {
    it('should return valid for correct HTTPS URL', () => {
      const result = validateSiteUrlFormat('https://example.com');
      expect(result.valid).toBe(true);
    });

    it('should return valid for HTTP URL', () => {
      const result = validateSiteUrlFormat('http://example.com');
      expect(result.valid).toBe(true);
    });

    it('should return invalid for malformed URL', () => {
      const result = validateSiteUrlFormat('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_FORMAT');
    });
  });

  describe('validateLicenseState', () => {
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

    it('should return success for active license with valid URL and quota', () => {
      // Arrange
      const license = createMockLicense();
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);

      // Act
      const result = validateLicenseState(license, 'https://example.com');

      // Assert
      expect(result.success).toBe(true);
      expect(result.license).toBeDefined();
    });

    it('should return LICENSE_EXPIRED error for expired license', () => {
      // Arrange
      const license = createMockLicense({ status: 'expired' });
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);

      // Act
      const result = validateLicenseState(license, 'https://example.com');

      // Assert
      expect(result.success).toBe(false);
      expect(result.code).toBe('LICENSE_EXPIRED');
      expect(result.error).toContain('expired');
    });

    it('should return LICENSE_EXPIRED error when expires_at is in the past', () => {
      // Arrange
      const license = createMockLicense();
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(true);

      // Act
      const result = validateLicenseState(license, 'https://example.com');

      // Assert
      expect(result.success).toBe(false);
      expect(result.code).toBe('LICENSE_EXPIRED');
    });

    it('should return URL_MISMATCH error for different site URL', () => {
      // Arrange
      const license = createMockLicense();
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);

      // Act
      const result = validateLicenseState(license, 'https://different-site.com');

      // Assert
      expect(result.success).toBe(false);
      expect(result.code).toBe('URL_MISMATCH');
      expect(result.error).toContain('Site URL does not match');
    });

    it('should return QUOTA_EXCEEDED error when tokens are exhausted', () => {
      // Arrange
      const license = createMockLicense({
        tokens_limit: 1000,
        tokens_used: 1000, // Exactly at limit
      });
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);

      // Act
      const result = validateLicenseState(license, 'https://example.com');

      // Assert
      expect(result.success).toBe(false);
      expect(result.code).toBe('QUOTA_EXCEEDED');
      expect(result.error).toContain('quota exceeded');
    });

    it('should return LICENSE_SUSPENDED error for suspended license', () => {
      // Arrange
      const license = createMockLicense({ status: 'suspended' });

      // Act
      const result = validateLicenseState(license, 'https://example.com');

      // Assert
      expect(result.success).toBe(false);
      expect(result.code).toBe('LICENSE_SUSPENDED');
    });
  });

  describe('processLicenseValidation', () => {
    const validRequest = {
      license_key: 'CREATOR-2024-ABCDE-FGHIJ',
      site_url: 'https://example.com',
    };

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

    it('should return success with JWT for valid active license', async () => {
      // Arrange
      const mockLicense = createMockLicense();
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(mockLicense);
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');
      (firestore.updateLicense as jest.Mock).mockResolvedValue(undefined);
      (firestore.timestampToISO as jest.Mock).mockReturnValue('2025-12-01T00:00:00.000Z');
      (jwt.generateToken as jest.Mock).mockReturnValue('mock-jwt-token');
      (jwt.decodeToken as jest.Mock).mockReturnValue(null); // No existing token

      // Act
      const result = await processLicenseValidation(
        validRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.site_token).toBe('mock-jwt-token');
        expect(result.user_id).toBe('user_123');
        expect(result.plan).toBe('pro');
        expect(result.tokens_remaining).toBe(900000);
      }
    });

    it('should return LICENSE_EXPIRED error for expired license', async () => {
      // Arrange
      const mockLicense = createMockLicense();
      mockLicense.status = 'expired';
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(mockLicense);
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');

      // Act
      const result = await processLicenseValidation(
        validRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('LICENSE_EXPIRED');
      }
    });

    it('should return URL_MISMATCH error for site URL mismatch', async () => {
      // Arrange
      const mockLicense = createMockLicense();
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(mockLicense);
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');

      const mismatchedRequest = {
        license_key: 'CREATOR-2024-ABCDE-FGHIJ',
        site_url: 'https://wrong-site.com',
      };

      // Act
      const result = await processLicenseValidation(
        mismatchedRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('URL_MISMATCH');
      }
    });

    it('should return QUOTA_EXCEEDED error when tokens are exhausted', async () => {
      // Arrange
      const mockLicense = createMockLicense();
      mockLicense.tokens_used = mockLicense.tokens_limit; // Exhausted
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(mockLicense);
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');

      // Act
      const result = await processLicenseValidation(
        validRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('QUOTA_EXCEEDED');
      }
    });

    it('should return LICENSE_NOT_FOUND for non-existent license', async () => {
      // Arrange
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(null);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');

      // Act
      const result = await processLicenseValidation(
        validRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('LICENSE_NOT_FOUND');
      }
    });

    it('should reuse existing valid token', async () => {
      // Arrange
      const mockLicense = createMockLicense();
      mockLicense.site_token = 'existing-valid-token';
      (firestore.getLicenseByKey as jest.Mock).mockResolvedValue(mockLicense);
      (firestore.isTimestampExpired as jest.Mock).mockReturnValue(false);
      (firestore.createAuditLog as jest.Mock).mockResolvedValue('audit_123');
      (firestore.timestampToISO as jest.Mock).mockReturnValue('2025-12-01T00:00:00.000Z');
      (jwt.decodeToken as jest.Mock).mockReturnValue({
        exp: Math.floor(Date.now() / 1000) + 3600, // Valid for 1 hour
      });
      (jwt.isTokenExpired as jest.Mock).mockReturnValue(false);

      // Act
      const result = await processLicenseValidation(
        validRequest,
        'test-jwt-secret',
        '192.168.1.1',
        mockLogger
      );

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.site_token).toBe('existing-valid-token');
      }
      expect(jwt.generateToken).not.toHaveBeenCalled();
    });
  });
});
