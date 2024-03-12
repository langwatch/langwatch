import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker, type Job } from "bullmq";
import { nanoid } from "nanoid";
import { env } from "../../../env.mjs";
import type { CheckTypes, TraceCheckResult } from "../../../trace_checks/types";
import type { TraceCheckJob } from "~/server/background/types";
import { prisma } from "../../db";
import { connection } from "../../redis";
import {
  TRACE_CHECKS_QUEUE_NAME,
  updateCheckStatusInES,
} from "../queues/traceChecksQueue";
import { getDebugger } from "../../../utils/logger";

const debug = getDebugger("langwatch:workers:traceChecksWorker");

export const startTraceChecksWorker = (
  processFn: (
    job: Job<TraceCheckJob, any, CheckTypes>
  ) => Promise<TraceCheckResult>
) => {
  const traceChecksWorker = new Worker<TraceCheckJob, any, CheckTypes>(
    TRACE_CHECKS_QUEUE_NAME,
    async (job) => {
      if (
        env.NODE_ENV !== "test" &&
        job.data.trace.trace_id.includes("test-trace")
      ) {
        return;
      }

      try {
        debug(`Processing job ${job.id} with data:`, job.data);
        const result = await processFn(job);

        for (const cost of result.costs) {
          await prisma.cost.create({
            data: {
              id: `cost_${nanoid()}`,
              projectId: job.data.trace.project_id,
              costType: CostType.TRACE_CHECK,
              costName: job.data.check.name,
              referenceType: CostReferenceType.CHECK,
              referenceId: job.data.check.id,
              amount: cost.amount,
              currency: cost.currency,
              extraInfo: {
                trace_check_id: job.id,
              },
            },
          });
        }

        await updateCheckStatusInES({
          check: job.data.check,
          trace: job.data.trace,
          status: result.status,
          raw_result: result.raw_result,
          value: result.value,
        });
        debug("Successfully processed job:", job.id);
      } catch (error) {
        await updateCheckStatusInES({
          check: job.data.check,
          trace: job.data.trace,
          status: "error",
          error: error,
        });
        debug("Failed to process job:", job.id, error);

        throw error;
      }
    },
    {
      connection,
      concurrency: 3,
    }
  );

  traceChecksWorker.on("ready", () => {
    debug("Trace worker active, waiting for jobs!");
  });

  traceChecksWorker.on("failed", (job, err) => {
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.captureException(err);
  });

  debug("Trace checks worker registered");
  return traceChecksWorker;
};
