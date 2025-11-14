import type { Job } from "bullmq";
import type { TraceProjectionJob } from "../types";
import { traceProjectionConsumerBullMq } from "../consumers";

export async function handleTraceProjectionJob(job: Job<TraceProjectionJob>): Promise<void> {
  if (!traceProjectionConsumerBullMq) {
    throw new Error("Trace projection consumer not available - ClickHouse client not configured");
  }

  await traceProjectionConsumerBullMq.consume(job.data);
}
