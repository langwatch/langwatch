import type { GetResponse } from "@elastic/elasticsearch/lib/api/types";
import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { TrackEventJob } from "~/server/background/types";
import {
  type ElasticSearchEvent,
  type Trace,
} from "../../../server/tracer/types";
import { getDebugger } from "../../../utils/logger";
import {
  EVENTS_INDEX,
  TRACE_INDEX,
  esClient,
  eventIndexId,
  traceIndexId,
} from "../../elasticsearch";
import { connection } from "../../redis";
import { elasticSearchEventSchema } from "../../tracer/types.generated";
import {
  TRACK_EVENTS_QUEUE_NAME,
  trackEventsQueue,
} from "../queues/trackEventsQueue";

const debug = getDebugger("langwatch:workers:trackEventWorker");

export const startTrackEventsWorker = () => {
  const trackEventsWorker = new Worker<TrackEventJob, void, string>(
    TRACK_EVENTS_QUEUE_NAME,
    async (job) => {
      debug(`Processing job ${job.id} with data:`, job.data);

      let event: ElasticSearchEvent = {
        ...job.data.event,
        project_id: job.data.project_id,
        metrics: Object.entries(job.data.event.metrics).map(([key, value]) => ({
          key,
          value,
        })),
        event_details: job.data.event.event_details
          ? Object.entries(job.data.event.event_details).map(
              ([key, value]) => ({ key, value })
            )
          : [],
        timestamps: {
          started_at: job.data.event.timestamp,
          inserted_at: Date.now(),
        },
      };
      // use zod to remove any other keys that may be present but not allowed
      event = elasticSearchEventSchema.parse(event);

      // Try to copy grouping keys from trace if event is connected to one
      if (event.trace_id) {
        let traceResult: GetResponse<Trace> | undefined = undefined;
        try {
          traceResult = await esClient.get<Trace>({
            index: TRACE_INDEX,
            id: traceIndexId({
              traceId: event.trace_id,
              projectId: job.data.project_id,
            }),
          });
        } catch {}

        const trace = traceResult?._source;
        if (trace) {
          event = {
            ...event,
            // Copy grouping keys
            thread_id: trace.thread_id,
            user_id: trace.user_id,
            customer_id: trace.customer_id,
            labels: trace.labels,
          };
        } else if (job.data.postpone_count < 3) {
          const delay = 5 * Math.pow(2, job.data.postpone_count);
          await trackEventsQueue.add(
            "track_event",
            { ...job.data, postpone_count: job.data.postpone_count + 1 },
            {
              jobId: `track_event_${event.event_id}_${job.data.postpone_count}`,
              delay: delay * 1000,
            }
          );
          return;
        }
      }

      await esClient.index({
        index: EVENTS_INDEX,
        id: eventIndexId({
          eventId: event.event_id,
          projectId: event.project_id,
        }),
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
