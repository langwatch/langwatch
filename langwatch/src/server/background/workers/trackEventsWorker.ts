import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { TrackEventJob } from "~/server/background/types";
import { getDebugger } from "../../../utils/logger";
import { connection } from "../../redis";
import { type Event } from "../../../server/tracer/types";
import { EVENTS_INDEX, esClient } from "../../elasticsearch";
import { TRACK_EVENTS_QUEUE_NAME } from "../queues/trackEventsQueue";

const debug = getDebugger("langwatch:workers:trackEventWorker");

export const startTrackEventsWorker = () => {
  const trackEventsWorker = new Worker<TrackEventJob, void, string>(
    TRACK_EVENTS_QUEUE_NAME,
    async (job) => {
      debug(`Processing job ${job.id} with data:`, job.data);

      const event: Event = {
        id: job.data.event.id,
        event_type: job.data.event.event_type,
        project_id: job.data.project_id,
        metrics: job.data.event.metrics,
        event_details: job.data.event.event_details ?? {},
        trace_id: job.data.event.trace_id,
        thread_id: job.data.event.thread_id,
        user_id: job.data.event.user_id,
        customer_id: job.data.event.customer_id,
        labels: job.data.event.labels,
        timestamps: {
          started_at: job.data.event.timestamp ?? Date.now(),
          inserted_at: Date.now(),
        },
      };

      await esClient.index({
        index: EVENTS_INDEX,
        id: event.id,
        body: event,
      });
    },
    {
      connection,
      concurrency: 3,
    }
  );

  trackEventsWorker.on("ready", () => {
    debug("Track event worker active, waiting for jobs!");
  });

  trackEventsWorker.on("failed", (job, err) => {
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.captureException(err);
  });

  debug("Track events worker registered");
  return trackEventsWorker;
};
