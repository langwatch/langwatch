import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { CollectorJob } from "~/server/background/types";
import { createLogger } from "../../../utils/logger";
import { connection } from "../../redis";
import { POSTGRES_FALLBACK_QUEUE_NAME } from "../queues/postgresFallbackQueue";
import { prisma } from "../../db";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { dependencies } from "../../../injection/dependencies.server";
import { getCurrentMonthMessagesCount } from "../../api/routers/limits";
import { processCollectorJob } from "./collectorWorker";

const logger = createLogger("langwatch:workers:postgresFallbackWorker");

export const startPostgresFallbackWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping postgres fallback worker");
    return;
  }

  const postgresFallbackWorker = new Worker<CollectorJob, void, string>(
    POSTGRES_FALLBACK_QUEUE_NAME,
    async (job) => {
      getJobProcessingCounter("postgres_fallback", "processing").inc();
      const start = Date.now();
      logger.info(
        { jobId: job.id, data: job.data },
        "processing postgres fallback job"
      );

      try {
        // Now we can process the job normally
        const project = await prisma.project.findUnique({
          where: { apiKey: job.data.authToken },
          include: { team: true },
        });

        if (!project) {
          logger.error(
            { jobId: job.id, projectId: job.data.projectId },
            "Project not found"
          );
          return;
        }

        logger.info({ jobId: job.id, projectId: project.id }, "Project found");

        //update the job data with the project id
        job.updateData({
          ...job.data,
          projectId: project.id,
        });

        // Check plan limits
        const currentMonthMessagesCount = await getCurrentMonthMessagesCount(
          [project.id],
          project.team.organizationId
        );

        const activePlan = await dependencies.subscriptionHandler.getActivePlan(
          project.team.organizationId
        );

        if (currentMonthMessagesCount >= activePlan.maxMessagesPerMonth) {
          logger.info(
            { projectId: project.id, currentMonthMessagesCount },
            "[429] Reached plan limit"
          );
          return;
        }

        // If we get here, we can process the job
        await processCollectorJob(job.id, job.data);

        getJobProcessingCounter("postgres_fallback", "completed").inc();
        const duration = Date.now() - start;
        getJobProcessingDurationHistogram("postgres_fallback").observe(
          duration
        );
      } catch (error) {
        getJobProcessingCounter("postgres_fallback", "failed").inc();
        logger.error(
          { jobId: job.id, error },
          "failed to process postgres fallback job"
        );
        Sentry.withScope((scope) => {
          scope.setTag("worker", "postgresFallback");
          scope.setExtra("job", job.data);
          Sentry.captureException(error);
        });
        throw error; // Let the queue handle retries
      }
    },
    {
      connection,
      concurrency: 3,
    }
  );

  postgresFallbackWorker.on("ready", () => {
    logger.info("postgres fallback worker active, waiting for jobs!");
  });

  logger.info("postgres fallback worker registered");
  return postgresFallbackWorker;
};
