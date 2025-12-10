/**
 * @fileoverview Unit tests for rate limiting middleware
 */

import { getClientIP } from "../middleware/rateLimit";
import { Request } from "firebase-functions/v2/https";

describe("Rate Limit Middleware", () => {
  describe("getClientIP", () => {
    const createMockRequest = (
      headers: Record<string, string | string[] | undefined> = {},
      socketIP?: string
    ): Partial<Request> => ({
      headers,
      socket: socketIP ? { remoteAddress: socketIP } as unknown as Request["socket"] : undefined,
      ip: socketIP,
    });

    it("should extract IP from X-Forwarded-For header", () => {
      const req = createMockRequest({
        "x-forwarded-for": "192.168.1.1, 10.0.0.1",
      });

      const ip = getClientIP(req as Request);
      expect(ip).toBe("192.168.1.1");
    });

    it("should extract IP from X-Forwarded-For array", () => {
      const req = createMockRequest({
        "x-forwarded-for": ["192.168.1.100"],
      });

      const ip = getClientIP(req as Request);
      expect(ip).toBe("192.168.1.100");
    });

    it("should extract IP from X-Real-IP header", () => {
      const req = createMockRequest({
        "x-real-ip": "10.0.0.50",
      });

      const ip = getClientIP(req as Request);
      expect(ip).toBe("10.0.0.50");
    });

    it("should prioritize X-Forwarded-For over X-Real-IP", () => {
      const req = createMockRequest({
        "x-forwarded-for": "192.168.1.1",
        "x-real-ip": "10.0.0.1",
      });

      const ip = getClientIP(req as Request);
      expect(ip).toBe("192.168.1.1");
    });

    it("should fallback to socket remoteAddress", () => {
      const req = createMockRequest({}, "127.0.0.1");

      const ip = getClientIP(req as Request);
      expect(ip).toBe("127.0.0.1");
    });

    it("should return 'unknown' when no IP found", () => {
      const req = createMockRequest();

      const ip = getClientIP(req as Request);
      expect(ip).toBe("unknown");
    });
  });
});
