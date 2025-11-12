import type { Job } from "bullmq";
import { createLogger } from "../../../../utils/logger";
import type { SpanIngestionWriteJob } from "../types";

const logger = createLogger("langwatch:features:span-ingestion:workers:handleSpanIngestionWriteJob");

export async function handleSpanIngestionWriteJob(
  job: Job<SpanIngestionWriteJob>,
): Promise<void> {
  logger.info({ job }, "handleSpanIngestionWriteJob");
  throw new Error("not implemented yet");
}
