/**
 * @fileoverview Unit tests for licensing service
 */

import {
  validateLicenseKeyFormat,
  validateSiteUrlFormat,
  validateLicenseState,
} from "../services/licensing";
import { License } from "../types/License";
import { Timestamp } from "firebase-admin/firestore";

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  apps: [],
  firestore: jest.fn(() => ({
    collection: jest.fn(),
  })),
}));

describe("Licensing Service", () => {
  describe("validateLicenseKeyFormat", () => {
    it("should accept valid license key format", () => {
      const validKeys = [
        "CREATOR-2024-ABCDE-FGHIJ",
        "CREATOR-2025-12345-67890",
        "CREATOR-2000-AAAAA-ZZZZZ",
      ];

      validKeys.forEach((key) => {
        const result = validateLicenseKeyFormat(key);
        expect(result.valid).toBe(true);
      });
    });

    it("should reject invalid license key formats", () => {
      const invalidKeys = [
        "",
        "CREATOR-24-ABCDE-FGHIJ", // Wrong year format
        "CREATOR-2024-ABCD-FGHIJ", // Too short section
        "CREATOR-2024-ABCDEF-FGHIJ", // Too long section
        "creator-2024-abcde-fghij", // Will be normalized, should pass
        "INVALID-2024-ABCDE-FGHIJ", // Wrong prefix
        "CREATOR2024ABCDEFGHIJ", // No dashes
        null as unknown as string,
        undefined as unknown as string,
      ];

      // Filter out lowercase (which should be normalized and pass)
      const reallyInvalid = invalidKeys.filter(
        (k) => k !== "creator-2024-abcde-fghij"
      );

      reallyInvalid.forEach((key) => {
        const result = validateLicenseKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.code).toBe("INVALID_FORMAT");
      });
    });

    it("should normalize lowercase keys to uppercase", () => {
      const result = validateLicenseKeyFormat("creator-2024-abcde-fghij");
      expect(result.valid).toBe(true);
    });
  });

  describe("validateSiteUrlFormat", () => {
    it("should accept valid URLs", () => {
      const validUrls = [
        "https://mysite.com",
        "http://localhost:8080",
        "https://sub.domain.example.com/path",
      ];

      validUrls.forEach((url) => {
        const result = validateSiteUrlFormat(url);
        expect(result.valid).toBe(true);
      });
    });

    it("should reject invalid URLs", () => {
      const invalidUrls = [
        "",
        "not-a-url",
        "ftp://invalid-protocol.com",
        null as unknown as string,
        undefined as unknown as string,
      ];

      invalidUrls.forEach((url) => {
        const result = validateSiteUrlFormat(url);
        expect(result.valid).toBe(false);
      });
    });
  });

  describe("validateLicenseState", () => {
    const createMockLicense = (overrides: Partial<License> = {}): License => {
      const now = new Date();
      const future = new Date(now.getTime() + 86400000 * 30); // 30 days from now
      const resetDate = new Date(now.getTime() + 86400000 * 7); // 7 days from now

      return {
        license_key: "CREATOR-2024-ABCDE-FGHIJ",
        site_url: "https://mysite.com",
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
    };

    it("should accept valid active license", () => {
      const license = createMockLicense();
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(true);
      expect(result.license).toBeDefined();
    });

    it("should reject suspended license", () => {
      const license = createMockLicense({ status: "suspended" });
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(false);
      expect(result.code).toBe("LICENSE_SUSPENDED");
    });

    it("should reject expired status license", () => {
      const license = createMockLicense({ status: "expired" });
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(false);
      expect(result.code).toBe("LICENSE_EXPIRED");
    });

    it("should reject license with expired timestamp", () => {
      const past = new Date(Date.now() - 86400000); // Yesterday
      const license = createMockLicense({
        expires_at: Timestamp.fromDate(past),
      });
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(false);
      expect(result.code).toBe("LICENSE_EXPIRED");
    });

    it("should reject mismatched site URL", () => {
      const license = createMockLicense();
      const result = validateLicenseState(license, "https://othersite.com");

      expect(result.success).toBe(false);
      expect(result.code).toBe("URL_MISMATCH");
    });

    it("should normalize URLs for comparison", () => {
      const license = createMockLicense({
        site_url: "https://mysite.com/",
      });
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(true);
    });

    it("should reject license with exceeded quota", () => {
      const license = createMockLicense({
        tokens_limit: 1000,
        tokens_used: 1000,
      });
      const result = validateLicenseState(license, "https://mysite.com");

      expect(result.success).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
    });
  });
});
