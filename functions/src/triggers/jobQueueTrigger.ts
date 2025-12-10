/**
 * @fileoverview Firestore trigger for job queue processing
 * @module triggers/jobQueueTrigger
 *
 * @description
 * Automatically triggers job processing when a new document
 * is created in the job_queue collection.
 *
 * This is the entry point for background job processing.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { openaiApiKey, geminiApiKey, claudeApiKey } from "../lib/secrets";
import { createLogger } from "../lib/logger";
import { processJob, validateJob } from "../services/jobProcessor";
import { Job } from "../types/Job";

/**
 * Firestore trigger that processes new jobs
 *
 * @description
 * Triggered when a document is created in the job_queue collection.
 * Validates the job and initiates processing with retry logic.
 *
 * Configuration:
 * - Timeout: 540 seconds (9 minutes)
 * - Memory: 2GB
 * - Max instances: 50
 *
 * @fires onDocumentCreated job_queue/{jobId}
 */
export const processJobQueue = onDocumentCreated(
  {
    document: "job_queue/{jobId}",
    secrets: [openaiApiKey, geminiApiKey, claudeApiKey],
    timeoutSeconds: 540, // 9 minutes (1 min buffer before 10 min limit)
    memory: "2GiB",
    maxInstances: 50,
    region: "europe-west1",
  },
  async (event) => {
    const jobId = event.params.jobId;
    const jobData = event.data?.data() as Job | undefined;

    const logger = createLogger().child({
      trigger: "jobQueueTrigger",
      job_id: jobId,
    });

    logger.info("Job queue trigger fired", { job_id: jobId });

    // Validate event data
    if (!jobData) {
      logger.error("No job data in event");
      return;
    }

    // Validate job structure
    const validation = validateJob(jobData);
    if (!validation.valid) {
      logger.error("Invalid job data", { error: validation.error });
      return;
    }

    // Only process pending jobs
    if (jobData.status !== "pending") {
      logger.warn("Job is not in pending status, skipping", {
        status: jobData.status,
      });
      return;
    }

    try {
      // Process the job
      await processJob(
        jobData,
        {
          openai: openaiApiKey.value(),
          gemini: geminiApiKey.value(),
          claude: claudeApiKey.value(),
        },
        logger
      );

      logger.info("Job processing completed", { job_id: jobId });
    } catch (error) {
      logger.error("Unhandled error in job processing", {
        job_id: jobId,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      // The error will be handled by the processJob function itself
      // which updates the job status to failed
    }
  }
);
