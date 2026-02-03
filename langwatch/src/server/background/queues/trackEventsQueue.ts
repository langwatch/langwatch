import type { ConnectionOptions } from "bullmq";
import type { TrackEventJob } from "~/server/background/types";
import { connection } from "../../redis";
import { runTrackEventJob } from "../workers/trackEventsWorker";
import { TRACK_EVENTS_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { TRACK_EVENTS_QUEUE } from "./constants";

export const trackEventsQueue = new QueueWithFallback<
  TrackEventJob,
  void,
  string
>(TRACK_EVENTS_QUEUE.NAME, runTrackEventJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    attempts: 3,
    removeOnComplete: {
      age: 0, // immediately remove completed jobs
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 3, // 3 days
    },
  },
});
