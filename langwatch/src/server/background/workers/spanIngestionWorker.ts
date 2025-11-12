import type { Job } from "bullmq";

import type { ClickHouseWriteJob } from "../../features/span-ingestion/types";
import { processClickHouseWriteJob } from "../../features/span-ingestion/workers/processClickHouseWriteJob";

export async function spanIngestionWorker(
  job: Job<ClickHouseWriteJob>,
): Promise<void> {
  await processClickHouseWriteJob(job);
}
