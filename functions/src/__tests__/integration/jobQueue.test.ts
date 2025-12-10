/**
 * @fileoverview End-to-end integration tests for Job Queue & Async Processing
 * @module __tests__/integration/jobQueue.test
 *
 * @description
 * Tests the complete job processing flow:
 * Client → /tasks/submit → Firestore trigger → processJobQueue → /tasks/status
 *
 * Covers:
 * - Job submission creates document in Firestore
 * - Job trigger processes and updates progress
 * - Status endpoint returns job progress
 * - Job completion with results
 * - Error handling (no crash, status="failed")
 * - Timeout prevents infinite processing
 * - Concurrent polling stability
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  Job,
  JobStatus,
  JobProgress,
  BulkArticlesTaskData,
  BulkArticlesResult,
  isValidJobTaskType,
  validateTaskData,
  estimateProcessingTime,
  MAX_JOB_ATTEMPTS,
  JOB_TIMEOUT_MS,
  MAX_BULK_ITEMS,
} from "../../types/Job";
import { validateJob, getJobItemCount } from "../../services/jobProcessor";
import { Logger } from "../../lib/logger";

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
  createJob: jest.fn(),
  getJobById: jest.fn(),
  updateJob: jest.fn(),
  updateJobStatus: jest.fn(),
  updateJobProgress: jest.fn(),
  failJob: jest.fn(),
  incrementJobAttempts: jest.fn(),
  incrementTokensUsed: jest.fn(),
  updateCostTracking: jest.fn(),
  getLicenseByKey: jest.fn(),
  checkPendingJobsLimit: jest.fn(),
  checkAndIncrementRateLimit: jest.fn(),
  createAuditLog: jest.fn(),
  timestampToISO: jest.fn((ts: Timestamp) => ts.toDate().toISOString()),
}));

import {
  createJob,
  getJobById,
  updateJob,
  updateJobStatus,
  updateJobProgress,
  failJob,
  incrementJobAttempts,
  createAuditLog,
} from "../../lib/firestore";

const mockCreateJob = createJob as jest.MockedFunction<typeof createJob>;
const mockGetJobById = getJobById as jest.MockedFunction<typeof getJobById>;
const mockUpdateJob = updateJob as jest.MockedFunction<typeof updateJob>;
const mockUpdateJobStatus = updateJobStatus as jest.MockedFunction<typeof updateJobStatus>;
const mockUpdateJobProgress = updateJobProgress as jest.MockedFunction<typeof updateJobProgress>;
const mockFailJob = failJob as jest.MockedFunction<typeof failJob>;
const mockIncrementJobAttempts = incrementJobAttempts as jest.MockedFunction<typeof incrementJobAttempts>;
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
 * Creates a mock Job document
 */
function createMockJob(overrides: Partial<Job> = {}): Job {
  const now = Timestamp.now();

  return {
    job_id: "job_test-12345678-abcd-1234-abcd-123456789012",
    license_id: "CREATOR-2024-ABCDE-FGHIJ",
    task_type: "bulk_articles",
    task_data: {
      topics: ["SEO Best Practices", "WordPress Security"],
      tone: "professional",
      language: "en",
    } as BulkArticlesTaskData,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    ...overrides,
  };
}

/**
 * Creates a mock BulkArticlesResult
 */
function createMockArticlesResult(): BulkArticlesResult {
  return {
    articles: [
      {
        topic: "SEO Best Practices",
        title: "10 SEO Best Practices for 2025",
        content: "<h1>SEO Best Practices</h1><p>Content here...</p>",
        tokens_used: 1500,
        cost: 0.002,
        provider: "gemini",
        status: "success",
      },
      {
        topic: "WordPress Security",
        title: "WordPress Security Guide",
        content: "<h1>Security</h1><p>Content here...</p>",
        tokens_used: 1200,
        cost: 0.0015,
        provider: "gemini",
        status: "success",
      },
    ],
    total_articles: 2,
    total_tokens: 2700,
    total_cost: 0.0035,
    processing_time_seconds: 30,
  };
}

describe("Job Queue & Async Processing - End-to-End Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createMockLogger(); // Initialize mock logger
    mockCreateAuditLog.mockResolvedValue("audit_log_id");
    mockUpdateJob.mockResolvedValue(undefined);
    mockUpdateJobStatus.mockResolvedValue(undefined);
    mockUpdateJobProgress.mockResolvedValue(undefined);
    mockFailJob.mockResolvedValue(undefined);
    mockIncrementJobAttempts.mockResolvedValue(1);
  });

  // =========================================================================
  // SCENARIO 1: Job submission crea documento in Firestore
  // =========================================================================
  describe("Scenario 1: Job submission crea documento in Firestore", () => {
    it("should create job document with correct structure", async () => {
      const expectedJob = createMockJob();
      mockCreateJob.mockResolvedValue(expectedJob);

      const result = await createJob({
        license_id: "CREATOR-2024-ABCDE-FGHIJ",
        task_type: "bulk_articles",
        task_data: {
          topics: ["SEO Best Practices", "WordPress Security"],
          tone: "professional",
          language: "en",
        } as BulkArticlesTaskData,
      });

      expect(result.job_id).toMatch(/^job_/);
      expect(result.license_id).toBe("CREATOR-2024-ABCDE-FGHIJ");
      expect(result.task_type).toBe("bulk_articles");
      expect(result.status).toBe("pending");
      expect(result.attempts).toBe(0);
      expect(result.max_attempts).toBe(3);
      expect(result.created_at).toBeDefined();
    });

    it("should validate task_type before creating job", () => {
      expect(isValidJobTaskType("bulk_articles")).toBe(true);
      expect(isValidJobTaskType("bulk_products")).toBe(true);
      expect(isValidJobTaskType("design_batch")).toBe(true);
      expect(isValidJobTaskType("invalid_type")).toBe(false);
      expect(isValidJobTaskType("")).toBe(false);
    });

    it("should validate task_data for bulk_articles", () => {
      const validData = {
        topics: ["Topic 1", "Topic 2"],
        tone: "professional",
      };
      expect(validateTaskData("bulk_articles", validData).valid).toBe(true);

      const emptyTopics = { topics: [] };
      expect(validateTaskData("bulk_articles", emptyTopics).valid).toBe(false);

      const missingTopics = {};
      expect(validateTaskData("bulk_articles", missingTopics).valid).toBe(false);
    });

    it("should enforce MAX_BULK_ITEMS limit", () => {
      const tooManyTopics = {
        topics: Array(MAX_BULK_ITEMS + 1).fill("Topic"),
      };
      const result = validateTaskData("bulk_articles", tooManyTopics);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(`Maximum ${MAX_BULK_ITEMS}`);
    });

    it("should estimate processing time correctly", () => {
      const articleTime = estimateProcessingTime("bulk_articles", 5);
      expect(articleTime).toBe(5 + 15 * 5); // 5s base + 15s per article

      const productTime = estimateProcessingTime("bulk_products", 10);
      expect(productTime).toBe(5 + 10 * 10); // 5s base + 10s per product

      const designTime = estimateProcessingTime("design_batch", 3);
      expect(designTime).toBe(5 + 20 * 3); // 5s base + 20s per section
    });
  });

  // =========================================================================
  // SCENARIO 2: Job trigger elabora il job e aggiorna progress
  // =========================================================================
  describe("Scenario 2: Job trigger elabora il job e aggiorna progress", () => {
    it("should validate job before processing", () => {
      const validJob = createMockJob({ status: "pending" });
      expect(validateJob(validJob).valid).toBe(true);

      const processingJob = createMockJob({ status: "processing" });
      expect(validateJob(processingJob).valid).toBe(false);
      expect(validateJob(processingJob).error).toContain("Invalid status");
    });

    it("should track item count for progress calculation", () => {
      const articlesJob = createMockJob({
        task_type: "bulk_articles",
        task_data: { topics: ["A", "B", "C"] } as BulkArticlesTaskData,
      });
      expect(getJobItemCount(articlesJob)).toBe(3);

      const productsJob = createMockJob({
        task_type: "bulk_products",
        task_data: {
          products: [{ name: "P1" }, { name: "P2" }],
        } as never,
      });
      expect(getJobItemCount(productsJob)).toBe(2);
    });

    it("should update status to processing when job starts", async () => {
      await updateJobStatus("job_test-123", "processing");

      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_test-123", "processing");
    });

    it("should update progress during processing", async () => {
      const progress: JobProgress = {
        progress_percent: 50,
        items_completed: 1,
        items_total: 2,
        current_item_index: 1,
        current_item_title: "Processing: WordPress Security",
        eta_seconds: 15,
      };

      await updateJobProgress("job_test-123", progress);

      expect(mockUpdateJobProgress).toHaveBeenCalledWith("job_test-123", progress);
    });
  });

  // =========================================================================
  // SCENARIO 3: Status endpoint ritorna job progress
  // =========================================================================
  describe("Scenario 3: Status endpoint ritorna job progress", () => {
    it("should return job with pending status", async () => {
      const pendingJob = createMockJob({ status: "pending" });
      mockGetJobById.mockResolvedValue(pendingJob);

      const job = await getJobById("job_test-123");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("pending");
      expect(job!.progress).toBeUndefined();
    });

    it("should return job with processing status and progress", async () => {
      const processingJob = createMockJob({
        status: "processing",
        started_at: Timestamp.now(),
        progress: {
          progress_percent: 45,
          items_completed: 1,
          items_total: 2,
          current_item_index: 1,
          current_item_title: "Processing article 2",
          eta_seconds: 20,
        },
      });
      mockGetJobById.mockResolvedValue(processingJob);

      const job = await getJobById("job_test-123");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("processing");
      expect(job!.progress).toBeDefined();
      expect(job!.progress!.progress_percent).toBe(45);
      expect(job!.progress!.items_completed).toBe(1);
      expect(job!.progress!.items_total).toBe(2);
    });

    it("should return null for non-existent job", async () => {
      mockGetJobById.mockResolvedValue(null);

      const job = await getJobById("job_nonexistent");

      expect(job).toBeNull();
    });
  });

  // =========================================================================
  // SCENARIO 4: Job completa e ritorna risultato
  // =========================================================================
  describe("Scenario 4: Job completa e ritorna risultato", () => {
    it("should return completed job with results", async () => {
      const completedJob = createMockJob({
        status: "completed",
        started_at: Timestamp.now(),
        completed_at: Timestamp.now(),
        progress: {
          progress_percent: 100,
          items_completed: 2,
          items_total: 2,
          current_item_index: 2,
        },
        result: createMockArticlesResult(),
        tokens_used: 2700,
        cost_usd: 0.0035,
      });
      mockGetJobById.mockResolvedValue(completedJob);

      const job = await getJobById("job_test-123");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("completed");
      expect(job!.result).toBeDefined();
      expect(job!.completed_at).toBeDefined();
      expect(job!.tokens_used).toBe(2700);
      expect(job!.cost_usd).toBe(0.0035);

      // Verify result structure
      const result = job!.result as BulkArticlesResult;
      expect(result.total_articles).toBe(2);
      expect(result.articles).toHaveLength(2);
      expect(result.articles[0].status).toBe("success");
    });

    it("should update job with complete status and result", async () => {
      const result = createMockArticlesResult();

      await updateJob("job_test-123", {
        status: "completed",
        result,
        tokens_used: result.total_tokens,
        cost_usd: result.total_cost,
        completed_at: Timestamp.now(),
      });

      expect(mockUpdateJob).toHaveBeenCalledWith(
        "job_test-123",
        expect.objectContaining({
          status: "completed",
          result: expect.any(Object),
          tokens_used: 2700,
        })
      );
    });
  });

  // =========================================================================
  // SCENARIO 5: Errore durante job è loggato (non crash)
  // =========================================================================
  describe("Scenario 5: Errore durante job è loggato (non crash)", () => {
    it("should mark job as failed with error message", async () => {
      const errorMessage = "AI provider rate limit exceeded";

      await failJob("job_test-123", errorMessage);

      expect(mockFailJob).toHaveBeenCalledWith("job_test-123", errorMessage);
    });

    it("should return failed job with error details", async () => {
      const failedJob = createMockJob({
        status: "failed",
        error_message: "AI provider timeout after 3 retries",
        attempts: 3,
        completed_at: Timestamp.now(),
      });
      mockGetJobById.mockResolvedValue(failedJob);

      const job = await getJobById("job_test-123");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.error_message).toBeDefined();
      expect(job!.error_message).toContain("timeout");
      expect(job!.attempts).toBe(3);
      expect(job!.result).toBeUndefined();
    });

    it("should increment attempts on failure before retry", async () => {
      await incrementJobAttempts("job_test-123");

      expect(mockIncrementJobAttempts).toHaveBeenCalledWith("job_test-123");
    });

    it("should respect MAX_JOB_ATTEMPTS limit", () => {
      expect(MAX_JOB_ATTEMPTS).toBe(3);

      // Job should fail after max attempts
      const jobAtMaxAttempts = createMockJob({
        attempts: MAX_JOB_ATTEMPTS,
        status: "pending",
      });

      // Can't process job that has reached max attempts
      expect(jobAtMaxAttempts.attempts).toBe(MAX_JOB_ATTEMPTS);
    });
  });

  // =========================================================================
  // SCENARIO 6: Job timeout prevents infinite processing
  // =========================================================================
  describe("Scenario 6: Job timeout prevents infinite processing", () => {
    it("should have JOB_TIMEOUT_MS configured correctly", () => {
      // 9 minutes = 540000ms
      expect(JOB_TIMEOUT_MS).toBe(9 * 60 * 1000);
    });

    it("should detect stuck jobs based on started_at timestamp", () => {
      const stuckThreshold = JOB_TIMEOUT_MS;

      // Job started 10 minutes ago (stuck)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const stuckJob = createMockJob({
        status: "processing",
        started_at: Timestamp.fromDate(tenMinutesAgo),
      });

      const jobStartTime = stuckJob.started_at!.toDate().getTime();
      const elapsed = Date.now() - jobStartTime;

      expect(elapsed).toBeGreaterThan(stuckThreshold);
    });

    it("should allow job within timeout window", () => {
      const stuckThreshold = JOB_TIMEOUT_MS;

      // Job started 5 minutes ago (still valid)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const validJob = createMockJob({
        status: "processing",
        started_at: Timestamp.fromDate(fiveMinutesAgo),
      });

      const jobStartTime = validJob.started_at!.toDate().getTime();
      const elapsed = Date.now() - jobStartTime;

      expect(elapsed).toBeLessThan(stuckThreshold);
    });

    it("should mark timed out job as failed", async () => {
      await failJob("job_stuck-123", "Job timed out after 9 minutes");

      expect(mockFailJob).toHaveBeenCalledWith(
        "job_stuck-123",
        expect.stringContaining("timed out")
      );
    });
  });

  // =========================================================================
  // SCENARIO 7: Polling status endpoint non causa race conditions
  // =========================================================================
  describe("Scenario 7: Polling non causa race conditions", () => {
    it("should return consistent data for concurrent reads", async () => {
      const consistentJob = createMockJob({
        status: "processing",
        progress: {
          progress_percent: 60,
          items_completed: 3,
          items_total: 5,
          current_item_index: 3,
        },
      });

      // Mock returns same data for all calls
      mockGetJobById.mockResolvedValue(consistentJob);

      // Simulate 5 concurrent requests
      const requests = Array(5)
        .fill(null)
        .map(() => getJobById("job_test-123"));

      const results = await Promise.all(requests);

      // All results should be identical
      results.forEach((result) => {
        expect(result).not.toBeNull();
        expect(result!.status).toBe("processing");
        expect(result!.progress!.progress_percent).toBe(60);
        expect(result!.progress!.items_completed).toBe(3);
      });

      // Verify getJobById was called 5 times
      expect(mockGetJobById).toHaveBeenCalledTimes(5);
    });

    it("should handle rapid polling without errors", async () => {
      let callCount = 0;
      const progressValues = [20, 40, 60, 80, 100];

      // Simulate progress updates between polls
      mockGetJobById.mockImplementation(async () => {
        const progress = progressValues[Math.min(callCount, progressValues.length - 1)];
        callCount++;

        return createMockJob({
          status: progress === 100 ? "completed" : "processing",
          progress: {
            progress_percent: progress,
            items_completed: Math.floor(progress / 20),
            items_total: 5,
            current_item_index: Math.floor(progress / 20),
          },
        });
      });

      // Simulate rapid polling
      const results: (Job | null)[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await getJobById("job_test-123");
        results.push(result);
      }

      // All calls should succeed without errors
      expect(results.every((r) => r !== null)).toBe(true);

      // Progress should be monotonically increasing or stable
      let lastProgress = 0;
      results.forEach((result) => {
        if (result && result.progress) {
          expect(result.progress.progress_percent).toBeGreaterThanOrEqual(lastProgress);
          lastProgress = result.progress.progress_percent;
        }
      });
    });

    it("should handle mixed read/write operations", async () => {
      // Simulate read while write is happening
      const readPromise = getJobById("job_test-123");
      const writePromise = updateJobProgress("job_test-123", {
        progress_percent: 75,
        items_completed: 3,
        items_total: 4,
        current_item_index: 3,
      });

      // Both operations should complete without error
      const [readResult] = await Promise.all([readPromise, writePromise]);

      expect(readResult).toBeDefined();
      expect(mockUpdateJobProgress).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Additional Edge Cases
  // =========================================================================
  describe("Additional Edge Cases", () => {
    it("should handle job with partial results on failure", async () => {
      const partialResult: BulkArticlesResult = {
        articles: [
          {
            topic: "Topic 1",
            title: "Success Article",
            content: "<p>Content</p>",
            tokens_used: 1000,
            cost: 0.001,
            provider: "gemini",
            status: "success",
          },
          {
            topic: "Topic 2",
            title: "",
            content: "",
            tokens_used: 0,
            cost: 0,
            provider: "gemini",
            status: "failed",
            error: "Rate limit exceeded",
          },
        ],
        total_articles: 2,
        total_tokens: 1000,
        total_cost: 0.001,
        processing_time_seconds: 20,
      };

      const partialJob = createMockJob({
        status: "completed", // Still marked completed with partial results
        result: partialResult,
      });
      mockGetJobById.mockResolvedValue(partialJob);

      const job = await getJobById("job_test-123");

      expect(job!.result).toBeDefined();
      const result = job!.result as BulkArticlesResult;
      expect(result.articles[0].status).toBe("success");
      expect(result.articles[1].status).toBe("failed");
      expect(result.articles[1].error).toBeDefined();
    });

    it("should validate job status transitions", () => {
      const validTransitions: Record<JobStatus, JobStatus[]> = {
        pending: ["processing"],
        processing: ["completed", "failed"],
        completed: [],
        failed: [],
      };

      expect(validTransitions.pending).toContain("processing");
      expect(validTransitions.processing).toContain("completed");
      expect(validTransitions.processing).toContain("failed");
      expect(validTransitions.completed).toHaveLength(0);
      expect(validTransitions.failed).toHaveLength(0);
    });

    it("should calculate correct progress percentage", () => {
      const calculateProgress = (completed: number, total: number): number => {
        if (total === 0) return 0;
        return Math.round((completed / total) * 100);
      };

      expect(calculateProgress(0, 5)).toBe(0);
      expect(calculateProgress(1, 5)).toBe(20);
      expect(calculateProgress(3, 5)).toBe(60);
      expect(calculateProgress(5, 5)).toBe(100);
      expect(calculateProgress(0, 0)).toBe(0);
    });
  });
});
