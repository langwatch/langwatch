import { type Job, Worker } from "bullmq";
import { connection } from "../server/redis";
import { getDebugger } from "../utils/logger";
import { updateCheckStatusInES } from "./queue";
import type {
  TopicClusteringJob,
  CheckTypes,
  TraceCheckJob,
  TraceCheckResult,
} from "./types";
import {
  esGetSpansByTraceId,
  esGetTraceById,
} from "../server/api/routers/traces";
import { env } from "../env.mjs";
import { getCheckExecutor } from "./backend/registry";
import { prisma } from "../server/db";
import { clusterTopicsForProject } from "./topic_clustering";

const debug = getDebugger("langwatch:workers");

// TODO: allow processing in batch
export const process = async (
  job: Job<TraceCheckJob, any, string>
): Promise<TraceCheckResult> => {
  const trace = await esGetTraceById(job.data.trace_id);
  const spans = await esGetSpansByTraceId(job.data.trace_id);
  if (!trace) {
    throw "trace not found";
  }

  const check = await prisma.check.findUnique({
    where: { id: job.data.check_id },
  });
  if (!check) {
    throw `check config ${job.data.check_id} not found`;
  }

  const checkExecutor = getCheckExecutor(check.checkType);
  if (!checkExecutor) {
    throw `trace executor not found for ${check.checkType}`;
  }

  return await checkExecutor.execute(
    trace,
    spans,
    (check.parameters ?? {}) as any
  );
};

export const start = (
  processMock:
    | ((job: Job<any, any, CheckTypes>) => Promise<TraceCheckResult>)
    | undefined = undefined,
  maxRuntimeMs: number | undefined = undefined
) => {
  return new Promise((resolve) => {
    const processFn = processMock ?? process;

    const traceChecksWorker = new Worker<any, any, CheckTypes>(
      "trace_checks",
      async (job) => {
        if (
          env.NODE_ENV !== "test" &&
          job.data.trace_id.includes("test-trace")
        ) {
          return;
        }

        try {
          debug(`Processing job ${job.id} with data:`, job.data);
          const result = await processFn(job);

          await updateCheckStatusInES({
            check_id: job.data.check_id,
            check_type: job.name,
            trace_id: job.data.trace_id,
            project_id: job.data.project_id,
            status: result.status,
            raw_result: result.raw_result,
            value: result.value,
          });
          debug("Successfully processed job:", job.id);
        } catch (error) {
          await updateCheckStatusInES({
            check_id: job.data.check_id,
            check_type: job.name,
            trace_id: job.data.trace_id,
            project_id: job.data.project_id,
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
    });

    debug("Trace checks worker registered");

    const topicClusteringWorker = new Worker<TopicClusteringJob, void, string>(
      "topic_clustering",
      async (job) => {
        debug(`Processing job ${job.id} with data:`, job.data);

        await clusterTopicsForProject(job.data.project_id);
      },
      {
        connection,
        concurrency: 3,
      }
    );

    topicClusteringWorker.on("ready", () => {
      debug("Topic clustering worker active, waiting for jobs!");
    });

    topicClusteringWorker.on("failed", (job, err) => {
      debug(`Job ${job?.id} failed with error ${err.message}`);
    });

    debug("Topic clustering checks worker registered");

    if (maxRuntimeMs) {
      setTimeout(() => {
        debug("Max runtime reached, closing worker");
        void (async () => {
          await traceChecksWorker.close();
          await topicClusteringWorker.close();
          resolve(undefined);
        })();
      }, maxRuntimeMs);
    }
  });
};
