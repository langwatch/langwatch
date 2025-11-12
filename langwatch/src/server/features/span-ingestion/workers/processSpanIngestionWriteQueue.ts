import type { Job } from "bullmq";

import type { SpanIngestionWriteJob } from "../types";

export async function processSpanIngestionWriteQueue(
  _job: Job<SpanIngestionWriteJob>,
): Promise<void> {
  // Implementation will be added in a later step.
  return;
}
