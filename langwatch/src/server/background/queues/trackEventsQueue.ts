import { Queue } from "bullmq";
import type { TrackEventJob } from "~/server/background/types";
import { connection } from "../../redis";

export const TRACK_EVENTS_QUEUE_NAME = "track_events";

export const trackEventsQueue = new Queue<TrackEventJob, void, string>(
  TRACK_EVENTS_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  }
);