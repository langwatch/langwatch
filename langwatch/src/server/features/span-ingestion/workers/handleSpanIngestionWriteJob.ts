import type { Job } from "bullmq";
import type { SpanIngestionWriteJob } from "../types/";
import { spanIngestionWriteConsumerClickHouse } from "../consumers";

export async function handleSpanIngestionWriteJob(
  job: Job<SpanIngestionWriteJob>,
): Promise<void> {
  await spanIngestionWriteConsumerClickHouse.consume(job.data);
}
