import { type Job, Worker } from "bullmq";
import { env } from "~/env.mjs";
import { createLogger } from "../../../utils/logger";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
// Import to ensure event sourcing is initialized
import "../../event-sourcing/runtime/eventSourcing";

const logger = createLogger("langwatch:workers:eventSourcingWorker");

// Define a simple job type for event sourcing maintenance tasks
export type EventSourcingJob = {
  action: "maintenance" | "health_check";
  timestamp: number;
};

export async function runEventSourcingJob(
  job: Job<EventSourcingJob, void, string>,
) {
  logger.info(
    { jobId: job.id, data: job.data },
    "processing event sourcing job",
  );
  getJobProcessingCounter("event_sourcing", "processing").inc();
  const start = Date.now();

  try {
    // Event sourcing initialization is handled by the import above
    // This worker ensures the system stays running and can handle maintenance tasks

    switch (job.data.action) {
      case "maintenance":
        // Perform any maintenance tasks if needed
        logger.debug("running event sourcing maintenance");
        break;
      case "health_check":
        // Health check - event sourcing is initialized if we reach here
        logger.debug("event sourcing health check passed");
        break;
      default:
        logger.warn(
          { action: job.data.action },
          "unknown event sourcing action",
        );
    }

    getJobProcessingCounter("event_sourcing", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("event_sourcing").observe(duration);
  } catch (error) {
    getJobProcessingCounter("event_sourcing", "failed").inc();
    logger.error(
      { jobId: job.id, error },
      "failed to process event sourcing job",
    );
    await withScope(async (scope) => {
      scope.setTag?.("worker", "eventSourcing");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
  }
}

export const startEventSourcingWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping event sourcing worker");
    return;
  }

  const eventSourcingWorker = new Worker<EventSourcingJob, void, string>(
    "event-sourcing", // queue name
    runEventSourcingJob,
    {
      connection,
      concurrency: 1, // Only one maintenance/health check job at a time
    },
  );

  eventSourcingWorker.on("ready", () => {
    logger.info(
      "event sourcing worker active, event sourcing system initialized",
    );
  });

  eventSourcingWorker.on("failed", async (job, err) => {
    logger.error(
      { jobId: job?.id, error: err.message },
      "event sourcing job failed",
    );
    getJobProcessingCounter("event_sourcing", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "eventSourcing");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("event sourcing worker registered");

  return eventSourcingWorker;
};
