import type { Job } from "bullmq";
import { createLogger } from "../../../../utils/logger";
import type { SpanIngestionWriteJob } from "../types/";

const logger = createLogger("langwatch:features:span-ingestion:workers:handleSpanIngestionWriteJob");

export async function handleSpanIngestionWriteJob(
  job: Job<SpanIngestionWriteJob>,
): Promise<void> {
  const { tenantId, spanData, collectedAtUnixMs } = job.data;

  logger.info({
    tenantId,
    spanId: spanData.spanId,
    traceId: spanData.traceId,
    collectedAtUnixMs,
  }, "handleSpanIngestionWriteJob");

  // TODO: Implement the actual span ingestion logic using spanData (the DTO)
  // spanData now contains all the JSON-serializable span information:
  // - spanData.traceId, spanData.spanId, spanData.traceFlags, etc.
  // - spanData.attributes, spanData.events, spanData.status, etc.
  // - spanData.resourceAttributes, spanData.instrumentationScope, etc.

  throw new Error("not implemented yet");
}
