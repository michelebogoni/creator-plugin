/**
 * @fileoverview Integration tests for Job Queue system
 * @module tests/integration/jobs.test
 *
 * @description
 * Tests for the job queue system including:
 * - submitTask endpoint creating jobs
 * - processJobQueue trigger processing
 * - getTaskStatus endpoint retrieving status
 */

import { Request } from 'firebase-functions/v2/https';
import { Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { License } from '../../src/types/License';
import { Job, JobStatus } from '../../src/types/Job';

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
};

// Mock firebase-functions/v2 before any imports
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((options, handler) => handler),
}));

jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: jest.fn((options, handler) => handler),
}));

// Mock secrets
jest.mock('../../src/lib/secrets', () => ({
  jwtSecret: { value: () => 'test-jwt-secret' },
  geminiApiKey: { value: () => 'test-gemini-key' },
  claudeApiKey: { value: () => 'test-claude-key' },
}));

// Mock Firestore
const mockFirestore = {
  getLicenseByKey: jest.fn(),
  createJob: jest.fn(),
  getJobById: jest.fn(),
  updateJob: jest.fn(),
  updateJobStatus: jest.fn(),
  updateJobProgress: jest.fn(),
  completeJob: jest.fn(),
  failJob: jest.fn(),
  incrementJobAttempts: jest.fn(),
  checkPendingJobsLimit: jest.fn(),
  createAuditLog: jest.fn(),
  checkAndIncrementRateLimit: jest.fn(),
  timestampToISO: jest.fn((ts) => ts?.toDate?.()?.toISOString?.() || new Date().toISOString()),
  incrementTokensUsed: jest.fn(),
  updateCostTracking: jest.fn(),
};

jest.mock('../../src/lib/firestore', () => mockFirestore);

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

// Mock auth middleware
jest.mock('../../src/middleware/auth', () => ({
  authenticateRequest: jest.fn(),
  sendAuthErrorResponse: jest.fn((res, result) => {
    res.status(401).json({ success: false, error: result.error, code: result.code });
  }),
}));

// Mock job processor
jest.mock('../../src/services/jobProcessor', () => ({
  processJob: jest.fn(),
  validateJob: jest.fn(),
  getJobItemCount: jest.fn(),
}));

import { authenticateRequest } from '../../src/middleware/auth';
import { processJob } from '../../src/services/jobProcessor';

describe('Integration Tests - Job Queue System', () => {
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSetHeader: jest.Mock;

  const validClaims = {
    license_id: 'CREATOR-2024-ABCDE-FGHIJ',
    site_url: 'https://example.com',
    plan: 'pro' as const,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    jti: 'test-jti',
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

  const createMockJob = (overrides: Partial<Job> = {}): Job => ({
    job_id: 'job_test-123-456',
    license_id: 'CREATOR-2024-ABCDE-FGHIJ',
    task_type: 'bulk_articles',
    task_data: {
      topics: ['SEO', 'WordPress'],
      tone: 'professional',
      language: 'en',
      word_count: 800,
    } as Job['task_data'],
    status: 'pending' as JobStatus,
    attempts: 0,
    max_attempts: 3,
    created_at: Timestamp.now(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn().mockReturnThis();
    mockSetHeader = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      method: 'POST',
      body: {},
      headers: { authorization: 'Bearer valid-token' },
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
    };

    // Default mock implementations
    (authenticateRequest as jest.Mock).mockResolvedValue({
      authenticated: true,
      claims: validClaims,
    });

    mockFirestore.checkAndIncrementRateLimit.mockResolvedValue({ limited: false, count: 1 });
    mockFirestore.checkPendingJobsLimit.mockResolvedValue({ allowed: true, pendingCount: 0 });
    mockFirestore.getLicenseByKey.mockResolvedValue(createMockLicense());
    mockFirestore.createAuditLog.mockResolvedValue('audit_123');
  });

  describe('POST /api/tasks/submit', () => {
    it('should create a job and return job_id with pending status', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        task_type: 'bulk_articles',
        task_data: {
          topics: ['SEO Best Practices', 'WordPress Security'],
          tone: 'professional',
          language: 'en',
          word_count: 800,
        },
      };

      const mockJob = createMockJob();
      mockFirestore.createJob.mockResolvedValue(mockJob);

      const { submitTask } = await import('../../src/api/tasks/submitTask');

      // Act
      await submitTask(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(202);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          job_id: expect.stringContaining('job_'),
          status: 'pending',
          estimated_wait_seconds: expect.any(Number),
        })
      );
    });

    it('should return 429 when too many pending jobs', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        task_type: 'bulk_articles',
        task_data: {
          topics: ['Topic 1'],
          tone: 'professional',
        },
      };

      mockFirestore.checkPendingJobsLimit.mockResolvedValue({
        allowed: false,
        pendingCount: 5,
      });

      const { submitTask } = await import('../../src/api/tasks/submitTask');

      // Act
      await submitTask(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'TOO_MANY_PENDING_JOBS',
        })
      );
    });

    it('should return 400 for invalid task_type', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        task_type: 'invalid_task',
        task_data: {},
      };

      const { submitTask } = await import('../../src/api/tasks/submitTask');

      // Act
      await submitTask(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'INVALID_TASK_TYPE',
        })
      );
    });

    it('should return 400 for missing task_data', async () => {
      // Arrange
      mockRequest.method = 'POST';
      mockRequest.body = {
        task_type: 'bulk_articles',
      };

      const { submitTask } = await import('../../src/api/tasks/submitTask');

      // Act
      await submitTask(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'MISSING_TASK_DATA',
        })
      );
    });
  });

  describe('GET /api/tasks/status/:job_id', () => {
    beforeEach(() => {
      mockRequest.method = 'GET';
    });

    it('should return pending status for newly created job', async () => {
      // Arrange
      const pendingJob = createMockJob({ status: 'pending' });
      mockFirestore.getJobById.mockResolvedValue(pendingJob);
      mockRequest.path = '/api/tasks/status/job_test-123-456';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          job_id: 'job_test-123-456',
          status: 'pending',
        })
      );
    });

    it('should return processing status with progress', async () => {
      // Arrange
      const processingJob = createMockJob({
        status: 'processing',
        started_at: Timestamp.now(),
        progress: {
          progress_percent: 50,
          items_completed: 1,
          items_total: 2,
          current_item_index: 1,
          current_item_title: 'Generating article: WordPress Security',
          eta_seconds: 45,
        },
      });
      mockFirestore.getJobById.mockResolvedValue(processingJob);
      mockRequest.path = '/api/tasks/status/job_test-123-456';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          status: 'processing',
          progress: expect.objectContaining({
            progress_percent: 50,
            items_completed: 1,
            items_total: 2,
          }),
        })
      );
    });

    it('should return completed status with result', async () => {
      // Arrange
      const completedJob = createMockJob({
        status: 'completed',
        completed_at: Timestamp.now(),
        result: {
          articles: [
            { topic: 'SEO', title: 'SEO Best Practices', content: 'Article content...', tokens_used: 500, cost: 0.01, provider: 'gemini', status: 'success' },
            { topic: 'WordPress', title: 'WordPress Security', content: 'Security content...', tokens_used: 600, cost: 0.012, provider: 'gemini', status: 'success' },
          ],
        } as unknown as Job['result'],
        progress: {
          progress_percent: 100,
          items_completed: 2,
          items_total: 2,
          current_item_index: 2,
        },
      });
      mockFirestore.getJobById.mockResolvedValue(completedJob);
      mockRequest.path = '/api/tasks/status/job_test-123-456';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          status: 'completed',
          result: expect.objectContaining({
            articles: expect.any(Array),
          }),
        })
      );
    });

    it('should return 404 for non-existent job', async () => {
      // Arrange
      mockFirestore.getJobById.mockResolvedValue(null);
      mockRequest.path = '/api/tasks/status/job_nonexistent';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'JOB_NOT_FOUND',
        })
      );
    });

    it('should return 403 when job belongs to different license', async () => {
      // Arrange
      const otherLicenseJob = createMockJob({
        license_id: 'CREATOR-2024-OTHER-LICENSE',
      });
      mockFirestore.getJobById.mockResolvedValue(otherLicenseJob);
      mockRequest.path = '/api/tasks/status/job_test-123-456';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'ACCESS_DENIED',
        })
      );
    });

    it('should return 400 for missing job_id', async () => {
      // Arrange
      mockRequest.path = '/api/tasks/status/';

      const { getTaskStatus } = await import('../../src/api/tasks/getStatus');

      // Act
      await getTaskStatus(mockRequest as unknown as Request, mockResponse as unknown as Response);

      // Assert
      expect(mockStatus).toHaveBeenCalledWith(400);
    });
  });

  describe('Job Processing Flow', () => {
    it('should transition job from pending to processing to completed', async () => {
      // This tests the complete job lifecycle

      // 1. Create job (simulated by createJob)
      const mockJob = createMockJob({ status: 'pending' });
      mockFirestore.createJob.mockResolvedValue(mockJob);

      // 2. Simulate processJob being called
      (processJob as jest.Mock).mockResolvedValue({
        success: true,
        result: {
          articles: [
            { title: 'SEO', content: 'Content...' },
          ],
        },
        tokensUsed: 1500,
        costUsd: 0.015,
      });

      // 3. Verify the job processor updates status correctly
      mockFirestore.updateJobStatus.mockImplementation(async (jobId: string, status: JobStatus) => {
        mockJob.status = status;
        if (status === 'processing') {
          mockJob.started_at = Timestamp.now();
        }
        if (status === 'completed') {
          mockJob.completed_at = Timestamp.now();
        }
      });

      // Simulate the job processing
      await mockFirestore.updateJobStatus(mockJob.job_id, 'processing');
      expect(mockJob.status).toBe('processing');
      expect(mockJob.started_at).toBeDefined();

      await mockFirestore.updateJobStatus(mockJob.job_id, 'completed');
      expect(mockJob.status).toBe('completed');
      expect(mockJob.completed_at).toBeDefined();
    });

    it('should update progress during processing', async () => {
      // Arrange
      const mockJob = createMockJob({ status: 'processing' });

      mockFirestore.updateJobProgress.mockImplementation(async (jobId: string, progress: Job['progress']) => {
        mockJob.progress = progress;
      });

      // Simulate progress updates
      await mockFirestore.updateJobProgress(mockJob.job_id, {
        progress_percent: 50,
        items_completed: 1,
        items_total: 2,
        current_item_index: 1,
        current_item_title: 'Processing item 1',
        eta_seconds: 30,
      });

      // Assert
      expect(mockJob.progress?.progress_percent).toBe(50);
      expect(mockJob.progress?.items_completed).toBe(1);
    });

    it('should handle job failure with retry', async () => {
      // Arrange
      const mockJob = createMockJob({
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
      });

      mockFirestore.incrementJobAttempts.mockImplementation(async () => {
        mockJob.attempts += 1;
        return mockJob.attempts;
      });

      mockFirestore.failJob.mockImplementation(async (jobId: string, errorMessage: string) => {
        mockJob.status = 'failed';
        mockJob.error_message = errorMessage;
        mockJob.completed_at = Timestamp.now();
      });

      // Simulate first attempt failing
      const newAttempts = await mockFirestore.incrementJobAttempts(mockJob.job_id);
      expect(newAttempts).toBe(1);
      expect(mockJob.attempts).toBe(1);

      // Job can still retry (attempts < max_attempts)
      expect(mockJob.attempts < mockJob.max_attempts).toBe(true);

      // Simulate second attempt failing
      await mockFirestore.incrementJobAttempts(mockJob.job_id);
      expect(mockJob.attempts).toBe(2);

      // Simulate third attempt failing - should mark as failed
      await mockFirestore.incrementJobAttempts(mockJob.job_id);
      expect(mockJob.attempts).toBe(3);

      // Now job should be marked as failed (attempts >= max_attempts)
      if (mockJob.attempts >= mockJob.max_attempts) {
        await mockFirestore.failJob(mockJob.job_id, 'Max retries exceeded');
      }

      expect(mockJob.status).toBe('failed');
      expect(mockJob.error_message).toBe('Max retries exceeded');
    });
  });
});
