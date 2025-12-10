/**
 * @fileoverview Unit tests for JWT utilities
 */

import {
  generateToken,
  verifyToken,
  extractBearerToken,
  decodeToken,
  isTokenExpired,
} from "../lib/jwt";
import { JWTPayload } from "../types/JWTClaims";

describe("JWT Utilities", () => {
  const TEST_SECRET = "test-secret-key-for-jwt-signing-32chars";
  const validPayload: JWTPayload = {
    license_id: "CREATOR-2024-ABCDE-FGHIJ",
    site_url: "https://mysite.com",
    plan: "pro",
  };

  describe("generateToken", () => {
    it("should generate a valid JWT token", () => {
      const token = generateToken(validPayload, TEST_SECRET);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("should throw error for empty secret", () => {
      expect(() => generateToken(validPayload, "")).toThrow(
        "JWT secret cannot be empty"
      );
    });

    it("should throw error for missing payload fields", () => {
      const invalidPayload = { license_id: "test" } as JWTPayload;

      expect(() => generateToken(invalidPayload, TEST_SECRET)).toThrow(
        "Invalid JWT payload"
      );
    });

    it("should include custom expiration time", () => {
      const token = generateToken(validPayload, TEST_SECRET, {
        expiresIn: 3600,
      });
      const decoded = decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded!.exp - decoded!.iat).toBe(3600);
    });

    it("should generate unique jti for each token", () => {
      const token1 = generateToken(validPayload, TEST_SECRET);
      const token2 = generateToken(validPayload, TEST_SECRET);

      const decoded1 = decodeToken(token1);
      const decoded2 = decodeToken(token2);

      expect(decoded1!.jti).not.toBe(decoded2!.jti);
    });
  });

  describe("verifyToken", () => {
    it("should verify a valid token", () => {
      const token = generateToken(validPayload, TEST_SECRET);
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(true);
      expect(result.claims).toBeDefined();
      expect(result.claims!.license_id).toBe(validPayload.license_id);
      expect(result.claims!.site_url).toBe(validPayload.site_url);
      expect(result.claims!.plan).toBe(validPayload.plan);
    });

    it("should reject token with wrong secret", () => {
      const token = generateToken(validPayload, TEST_SECRET);
      const result = verifyToken(token, "wrong-secret");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid token");
    });

    it("should reject empty token", () => {
      const result = verifyToken("", TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token cannot be empty");
    });

    it("should reject expired token", () => {
      const token = generateToken(validPayload, TEST_SECRET, {
        expiresIn: -1, // Already expired
      });
      const result = verifyToken(token, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token has expired");
    });

    it("should reject malformed token", () => {
      const result = verifyToken("not.a.valid.token.format", TEST_SECRET);

      expect(result.valid).toBe(false);
    });
  });

  describe("extractBearerToken", () => {
    it("should extract token from valid Bearer header", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
      const result = extractBearerToken(`Bearer ${token}`);

      expect(result).toBe(token);
    });

    it("should return null for missing header", () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it("should return null for invalid format", () => {
      expect(extractBearerToken("Basic abc123")).toBeNull();
      expect(extractBearerToken("Bearer")).toBeNull();
      expect(extractBearerToken("token")).toBeNull();
    });

    it("should be case insensitive for Bearer prefix", () => {
      const token = "test-token";
      expect(extractBearerToken(`bearer ${token}`)).toBe(token);
      expect(extractBearerToken(`BEARER ${token}`)).toBe(token);
    });
  });

  describe("decodeToken", () => {
    it("should decode a valid token without verification", () => {
      const token = generateToken(validPayload, TEST_SECRET);
      const decoded = decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded!.license_id).toBe(validPayload.license_id);
    });

    it("should return null for invalid token", () => {
      expect(decodeToken("invalid")).toBeNull();
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for non-expired token", () => {
      const token = generateToken(validPayload, TEST_SECRET);
      const claims = decodeToken(token)!;

      expect(isTokenExpired(claims)).toBe(false);
    });

    it("should return true for expired token", () => {
      const claims = {
        license_id: "test",
        site_url: "https://test.com",
        plan: "pro" as const,
        iat: Math.floor(Date.now() / 1000) - 100000,
        exp: Math.floor(Date.now() / 1000) - 1,
        jti: "test-id",
      };

      expect(isTokenExpired(claims)).toBe(true);
    });
  });
});
