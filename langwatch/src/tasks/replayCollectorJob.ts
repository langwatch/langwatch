import { nanoid } from "nanoid";
import type { CollectorJob } from "../server/background/types";
import { processCollectorJob } from "../server/background/workers/collectorWorker";

const jobData: CollectorJob = {
  projectId: "EEisP6epvj-no_veGiHTQ",
  traceId: "YV8LVKtcS72wYq4IUlCsl",
  spans: [],
  reservedTraceMetadata: {
    thread_id: "66ab681faadf42f6940f64d3",
    customer_id: "63343c1a0a217b5916cf6740",
    labels: [],
    sdk_version: "0.1.15",
    sdk_language: "python",
  },
  customMetadata: {},
  expectedOutput: null,
  paramsMD5: nanoid(),
};

export default async function execute() {
  await processCollectorJob(undefined, jobData);
}
