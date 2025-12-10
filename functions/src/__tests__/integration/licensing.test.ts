/**
 * @fileoverview End-to-end integration tests for Licensing Workflow
 * @module __tests__/integration/licensing.test
 *
 * @description
 * Tests the complete licensing flow:
 * Client → validate-license → JWT → protected endpoints
 *
 * Covers:
 * - License validation (active, expired, suspended)
 * - JWT generation and verification
 * - Site URL validation
 * - Quota enforcement
 * - Middleware authentication
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  processLicenseValidation,
  validateLicenseState,
} from "../../services/licensing";
import {
  generateToken,
  verifyToken,
  extractBearerToken,
  isTokenExpired,
  decodeToken,
} from "../../lib/jwt";
import { authenticateRequest } from "../../middleware/auth";
import { License } from "../../types/License";
import { Logger } from "../../lib/logger";
import { Request } from "express";

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  apps: [],
  firestore: jest.fn(() => ({
    collection: jest.fn(),
  })),
}));

// Mock Firestore operations
jest.mock("../../lib/firestore", () => ({
  getLicenseByKey: jest.fn(),
  updateLicense: jest.fn(),
  createAuditLog: jest.fn(),
  isTimestampExpired: jest.fn((ts: Timestamp) => {
    return ts.toDate().getTime() < Date.now();
  }),
  timestampToISO: jest.fn((ts: Timestamp) => ts.toDate().toISOString()),
}));

import {
  getLicenseByKey,
  updateLicense,
  createAuditLog,
} from "../../lib/firestore";

const mockGetLicenseByKey = getLicenseByKey as jest.MockedFunction<typeof getLicenseByKey>;
const mockUpdateLicense = updateLicense as jest.MockedFunction<typeof updateLicense>;
const mockCreateAuditLog = createAuditLog as jest.MockedFunction<typeof createAuditLog>;

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
 * Creates a mock license document
 */
function createMockLicense(overrides: Partial<License> = {}): License {
  const now = new Date();
  const future = new Date(now.getTime() + 86400000 * 30); // 30 days
  const resetDate = new Date(now.getTime() + 86400000 * 7); // 7 days

  return {
    license_key: "CREATOR-2024-ABCDE-FGHIJ",
    site_url: "https://test.com",
    user_id: "user_123",
    plan: "pro",
    tokens_limit: 50000000,
    tokens_used: 1000000,
    status: "active",
    reset_date: Timestamp.fromDate(resetDate),
    expires_at: Timestamp.fromDate(future),
    created_at: Timestamp.fromDate(now),
    updated_at: Timestamp.fromDate(now),
    ...overrides,
  };
}

/**
 * Creates a mock Express request
 */
function createMockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers,
    body: {},
    query: {},
    params: {},
  } as unknown as Request;
}

const TEST_SECRET = "test-jwt-secret-key-at-least-32-characters-long";

describe("Licensing Workflow - End-to-End Integration", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockCreateAuditLog.mockResolvedValue("audit_log_id");
    mockUpdateLicense.mockResolvedValue();
  });

  // =========================================================================
  // SCENARIO 1: License attiva genera JWT valido
  // =========================================================================
  describe("Scenario 1: License attiva genera JWT valido", () => {
    it("should generate valid JWT for active license with matching site_url", async () => {
      const mockLicense = createMockLicense({
        status: "active",
        site_url: "https://test.com",
        tokens_limit: 50000000,
        tokens_used: 1000000,
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      // Verify success
      expect(result.success).toBe(true);

      if (result.success) {
        // Verify JWT is present
        expect(result.site_token).toBeDefined();
        expect(typeof result.site_token).toBe("string");

        // Verify JWT structure (3 parts)
        expect(result.site_token.split(".")).toHaveLength(3);

        // Verify JWT can be decoded and contains correct claims
        const decoded = decodeToken(result.site_token);
        expect(decoded).not.toBeNull();
        expect(decoded!.license_id).toBe("CREATOR-2024-ABCDE-FGHIJ");
        expect(decoded!.site_url).toBe("https://test.com");
        expect(decoded!.plan).toBe("pro");

        // Verify JWT is not expired
        expect(isTokenExpired(decoded!)).toBe(false);

        // Verify JWT can be verified with secret
        const verifyResult = verifyToken(result.site_token, TEST_SECRET);
        expect(verifyResult.valid).toBe(true);

        // Verify other response fields
        expect(result.plan).toBe("pro");
        expect(result.tokens_limit).toBe(50000000);
        expect(result.tokens_remaining).toBe(49000000);
      }
    });

    it("should reuse existing valid token if present", async () => {
      const existingToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET
      );

      const mockLicense = createMockLicense({
        site_token: existingToken,
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.site_token).toBe(existingToken);
      }
    });
  });

  // =========================================================================
  // SCENARIO 2: License scaduta genera errore
  // =========================================================================
  describe("Scenario 2: License scaduta genera errore", () => {
    it("should return LICENSE_EXPIRED for license with expired status", async () => {
      const mockLicense = createMockLicense({
        status: "expired",
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("LICENSE_EXPIRED");
        expect(result.error).toContain("expired");
      }
    });

    it("should return LICENSE_EXPIRED for license with past expiration date", async () => {
      const past = new Date(Date.now() - 86400000); // Yesterday
      const mockLicense = createMockLicense({
        status: "active",
        expires_at: Timestamp.fromDate(past),
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("LICENSE_EXPIRED");
      }
    });

    it("should return LICENSE_SUSPENDED for suspended license", async () => {
      const mockLicense = createMockLicense({
        status: "suspended",
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("LICENSE_SUSPENDED");
      }
    });
  });

  // =========================================================================
  // SCENARIO 3: Site URL mismatch causa errore
  // =========================================================================
  describe("Scenario 3: Site URL mismatch causa errore", () => {
    it("should return URL_MISMATCH when site URLs don't match", async () => {
      const mockLicense = createMockLicense({
        site_url: "https://registered-site.com",
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://different-site.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("URL_MISMATCH");
        expect(result.error).toContain("does not match");
      }
    });

    it("should normalize URLs for comparison (trailing slash)", () => {
      const license = createMockLicense({
        site_url: "https://test.com/",
      });

      const result = validateLicenseState(license, "https://test.com");
      expect(result.success).toBe(true);
    });

    it("should normalize URLs for comparison (case insensitive hostname)", () => {
      const license = createMockLicense({
        site_url: "https://TEST.COM",
      });

      const result = validateLicenseState(license, "https://test.com");
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 4: JWT scaduto non passa middleware
  // =========================================================================
  describe("Scenario 4: JWT scaduto non passa middleware", () => {
    it("should reject expired JWT token in verifyToken", () => {
      // Generate token that expires in -1 seconds (already expired)
      const expiredToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET,
        { expiresIn: -1 }
      );

      const result = verifyToken(expiredToken, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token has expired");
    });

    it("should reject expired JWT in authenticateRequest middleware", async () => {
      const expiredToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET,
        { expiresIn: -1 }
      );

      const req = createMockRequest({
        authorization: `Bearer ${expiredToken}`,
      });

      const result = await authenticateRequest(req, TEST_SECRET, mockLogger);

      expect(result.authenticated).toBe(false);
      expect(result.code).toBe("INVALID_TOKEN");
    });

    it("should correctly identify expired token using isTokenExpired", () => {
      const expiredClaims = {
        license_id: "test",
        site_url: "https://test.com",
        plan: "pro" as const,
        iat: Math.floor(Date.now() / 1000) - 100000,
        exp: Math.floor(Date.now() / 1000) - 1, // Expired 1 second ago
        jti: "test-id",
      };

      expect(isTokenExpired(expiredClaims)).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 5: JWT valido passa middleware
  // =========================================================================
  describe("Scenario 5: JWT valido passa middleware", () => {
    it("should accept valid JWT and return claims", async () => {
      const validToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET,
        { expiresIn: 86400 } // 24 hours
      );

      const mockLicense = createMockLicense();
      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const req = createMockRequest({
        authorization: `Bearer ${validToken}`,
      });

      const result = await authenticateRequest(req, TEST_SECRET, mockLogger);

      expect(result.authenticated).toBe(true);
      expect(result.claims).toBeDefined();
      expect(result.claims!.license_id).toBe("CREATOR-2024-ABCDE-FGHIJ");
      expect(result.claims!.site_url).toBe("https://test.com");
      expect(result.claims!.plan).toBe("pro");
    });

    it("should reject valid JWT if license is no longer active", async () => {
      const validToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET
      );

      const mockLicense = createMockLicense({ status: "suspended" });
      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const req = createMockRequest({
        authorization: `Bearer ${validToken}`,
      });

      const result = await authenticateRequest(req, TEST_SECRET, mockLogger);

      expect(result.authenticated).toBe(false);
      expect(result.code).toBe("LICENSE_SUSPENDED");
    });

    it("should reject request without Authorization header", async () => {
      const req = createMockRequest({});

      const result = await authenticateRequest(req, TEST_SECRET, mockLogger);

      expect(result.authenticated).toBe(false);
      expect(result.code).toBe("MISSING_AUTH");
    });

    it("should reject malformed Authorization header", async () => {
      const req = createMockRequest({
        authorization: "InvalidFormat token123",
      });

      const result = await authenticateRequest(req, TEST_SECRET, mockLogger);

      expect(result.authenticated).toBe(false);
      expect(result.code).toBe("MISSING_AUTH");
    });

    it("should extract bearer token correctly", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature";

      expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
      expect(extractBearerToken(`bearer ${token}`)).toBe(token);
      expect(extractBearerToken(`BEARER ${token}`)).toBe(token);
      expect(extractBearerToken("Basic abc")).toBeNull();
      expect(extractBearerToken(undefined)).toBeNull();
    });
  });

  // =========================================================================
  // SCENARIO 6: Quota esaurita genera errore
  // =========================================================================
  describe("Scenario 6: Quota esaurita genera errore", () => {
    it("should return QUOTA_EXCEEDED when tokens_used >= tokens_limit", async () => {
      const mockLicense = createMockLicense({
        tokens_limit: 1000,
        tokens_used: 1000, // Exactly at limit
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("QUOTA_EXCEEDED");
        expect(result.error).toContain("quota");
      }
    });

    it("should return QUOTA_EXCEEDED when tokens_used > tokens_limit", async () => {
      const mockLicense = createMockLicense({
        tokens_limit: 1000,
        tokens_used: 1500, // Over limit
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("QUOTA_EXCEEDED");
      }
    });

    it("should allow request when quota is available", () => {
      const license = createMockLicense({
        tokens_limit: 1000,
        tokens_used: 999, // 1 token remaining
      });

      const result = validateLicenseState(license, "https://test.com");
      expect(result.success).toBe(true);
    });

    it("should validate quota in validateLicenseState", () => {
      const licenseAtLimit = createMockLicense({
        tokens_limit: 100,
        tokens_used: 100,
      });

      const result = validateLicenseState(licenseAtLimit, "https://test.com");
      expect(result.success).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
    });
  });

  // =========================================================================
  // Additional Edge Cases
  // =========================================================================
  describe("Additional Edge Cases", () => {
    it("should return LICENSE_NOT_FOUND for non-existent license", async () => {
      mockGetLicenseByKey.mockResolvedValue(null);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-XXXXX-XXXXX",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("LICENSE_NOT_FOUND");
      }
    });

    it("should reject invalid license key format", async () => {
      const result = await processLicenseValidation(
        {
          license_key: "INVALID-KEY",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("INVALID_FORMAT");
      }
    });

    it("should reject invalid site URL format", async () => {
      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "not-a-valid-url",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("INVALID_FORMAT");
      }
    });

    it("should generate new token when existing token is expired", async () => {
      const expiredToken = generateToken(
        {
          license_id: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
          plan: "pro",
        },
        TEST_SECRET,
        { expiresIn: -1 }
      );

      const mockLicense = createMockLicense({
        site_token: expiredToken,
      });

      mockGetLicenseByKey.mockResolvedValue(mockLicense);

      const result = await processLicenseValidation(
        {
          license_key: "CREATOR-2024-ABCDE-FGHIJ",
          site_url: "https://test.com",
        },
        TEST_SECRET,
        "192.168.1.1",
        mockLogger
      );

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have generated a new token
        expect(result.site_token).not.toBe(expiredToken);

        // New token should be valid
        const verifyResult = verifyToken(result.site_token, TEST_SECRET);
        expect(verifyResult.valid).toBe(true);
      }
    });
  });
});
