import type { ConnectionOptions } from "bullmq";
import { connection } from "../../redis";
import {
  type LangyBootstrapJob,
  runLangyBootstrapJob,
} from "../workers/langyBootstrapWorker";
import { LANGY_BOOTSTRAP_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { LANGY_BOOTSTRAP_QUEUE } from "./constants";

export const langyBootstrapQueue = new QueueWithFallback<
  LangyBootstrapJob,
  void,
  string
>(LANGY_BOOTSTRAP_QUEUE.NAME, runLangyBootstrapJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    attempts: 3,
    removeOnComplete: {
      age: 0,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7, // 7 days
    },
  },
});

export const enqueueLangyBootstrap = async (projectId: string) => {
  return await langyBootstrapQueue.add(
    LANGY_BOOTSTRAP_QUEUE.JOB,
    { projectId },
    { jobId: `langy_bootstrap_${projectId}` },
  );
};
