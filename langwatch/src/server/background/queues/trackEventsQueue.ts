import type { TrackEventJob } from "~/server/background/types";
import { connection } from "../../redis";
import { QueueWithFallback } from "./queueWithFallback";
import { runTrackEventJob } from "../workers/trackEventsWorker";

export const TRACK_EVENTS_QUEUE_NAME = "track_events";

export const trackEventsQueue = new QueueWithFallback<
  TrackEventJob,
  void,
  string
>(TRACK_EVENTS_QUEUE_NAME, runTrackEventJob, {
  connection: connection as any,
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
