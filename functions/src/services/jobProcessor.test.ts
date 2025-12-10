/**
 * @fileoverview Unit tests for Job Processor Service
 * @module services/jobProcessor.test
 */

import {
  validateJob,
  getJobItemCount,
} from "./jobProcessor";
import { Job, BulkArticlesTaskData, BulkProductsTaskData, DesignBatchTaskData } from "../types/Job";
import { Timestamp } from "firebase-admin/firestore";

// Mock Timestamp for testing
const mockTimestamp = {
  toMillis: () => Date.now(),
  toDate: () => new Date(),
} as Timestamp;

describe("jobProcessor", () => {
  describe("validateJob", () => {
    const createValidJob = (overrides: Partial<Job> = {}): Job => ({
      job_id: "job_test-123",
      license_id: "CREATOR-2024-TEST",
      task_type: "bulk_articles",
      task_data: {
        topics: ["Test Topic"],
      } as BulkArticlesTaskData,
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      created_at: mockTimestamp,
      ...overrides,
    });

    it("should return valid for a properly structured job", () => {
      const job = createValidJob();
      const result = validateJob(job);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return invalid if job_id is missing", () => {
      const job = createValidJob({ job_id: "" });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing job_id");
    });

    it("should return invalid if license_id is missing", () => {
      const job = createValidJob({ license_id: "" });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing license_id");
    });

    it("should return invalid if task_type is missing", () => {
      const job = createValidJob({ task_type: "" as never });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing task_type");
    });

    it("should return invalid if task_data is missing", () => {
      const job = createValidJob({ task_data: undefined as never });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing task_data");
    });

    it("should return invalid if status is not pending", () => {
      const job = createValidJob({ status: "processing" });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid status for processing: processing");
    });

    it("should return invalid for completed status", () => {
      const job = createValidJob({ status: "completed" });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid status");
    });

    it("should return invalid for failed status", () => {
      const job = createValidJob({ status: "failed" });
      const result = validateJob(job);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid status");
    });
  });

  describe("getJobItemCount", () => {
    it("should return topic count for bulk_articles", () => {
      const job: Job = {
        job_id: "job_test",
        license_id: "LICENSE",
        task_type: "bulk_articles",
        task_data: {
          topics: ["Topic 1", "Topic 2", "Topic 3"],
        } as BulkArticlesTaskData,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: mockTimestamp,
      };

      expect(getJobItemCount(job)).toBe(3);
    });

    it("should return product count for bulk_products", () => {
      const job: Job = {
        job_id: "job_test",
        license_id: "LICENSE",
        task_type: "bulk_products",
        task_data: {
          products: [
            { name: "Product 1" },
            { name: "Product 2" },
          ],
        } as BulkProductsTaskData,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: mockTimestamp,
      };

      expect(getJobItemCount(job)).toBe(2);
    });

    it("should return section count for design_batch", () => {
      const job: Job = {
        job_id: "job_test",
        license_id: "LICENSE",
        task_type: "design_batch",
        task_data: {
          sections: [
            { name: "Hero", description: "Hero section" },
            { name: "Features", description: "Features section" },
            { name: "CTA", description: "Call to action" },
            { name: "Footer", description: "Footer section" },
          ],
        } as DesignBatchTaskData,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: mockTimestamp,
      };

      expect(getJobItemCount(job)).toBe(4);
    });

    it("should return 0 for empty topics array", () => {
      const job: Job = {
        job_id: "job_test",
        license_id: "LICENSE",
        task_type: "bulk_articles",
        task_data: {
          topics: [],
        } as BulkArticlesTaskData,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: mockTimestamp,
      };

      expect(getJobItemCount(job)).toBe(0);
    });

    it("should return 0 for missing topics property", () => {
      const job: Job = {
        job_id: "job_test",
        license_id: "LICENSE",
        task_type: "bulk_articles",
        task_data: {} as BulkArticlesTaskData,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        created_at: mockTimestamp,
      };

      expect(getJobItemCount(job)).toBe(0);
    });
  });
});
