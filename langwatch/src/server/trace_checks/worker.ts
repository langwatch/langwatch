import { type Job, Worker } from "bullmq";
import { connection } from "../redis";
import { getDebugger } from "../../utils/logger";
import { updateCheckStatusInES } from "./queue";
import type { TraceCheckJob, TraceCheckResult } from "./types";
import { esGetTraceById } from "../api/routers/traces";
import { env } from "../../env.mjs";
import { getTraceCheck } from "./registry";

const debug = getDebugger("langwatch:trace_checks:workers");

// TODO: allow processing in batch
export const process = async (
  job: Job<TraceCheckJob, any, string>
): Promise<TraceCheckResult> => {
  const trace = await esGetTraceById(job.data.trace_id);

  if (!trace) {
    throw "trace not found";
  }

  const traceCheck = getTraceCheck(job.name);
  if (!traceCheck) {
    throw "trace check not found";
  }

  return await traceCheck.execute(trace, []);
};

export const start = (
  processMock:
    | ((job: Job<any, any, string>) => Promise<TraceCheckResult>)
    | undefined = undefined
) => {
  const processFn = processMock ?? process;

  const worker = new Worker(
    "trace_checks",
    async (job) => {
      if (env.NODE_ENV !== "test" && job.data.trace_id.includes("test-trace")) {
        return;
      }

      try {
        debug(`Processing job ${job.id} with data:`, job.data);
        const result = await processFn(job);

        await updateCheckStatusInES({
          check_type: job.name,
          trace_id: job.data.trace_id,
          project_id: job.data.project_id,
          status: "succeeded",
          raw_result: result.raw_result,
          value: result.value,
        });
        debug("Successfully processed job:", job.id);
      } catch (error) {
        await updateCheckStatusInES({
          check_type: job.name,
          trace_id: job.data.trace_id,
          project_id: job.data.project_id,
          status: "failed",
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

  worker.on("ready", () => {
    debug("Worker active, waiting for jobs!");
  });

  worker.on("failed", (job, err) => {
    debug(`Job ${job?.id} failed with error ${err.message}`);
  });

  debug("Trace checks worker registered");

  return worker;
};
