import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { TrackEventJob } from "~/server/background/types";
import {
  type ElasticSearchEvent,
  type ElasticSearchTrace,
} from "../../../server/tracer/types";
import { getDebugger } from "../../../utils/logger";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import { connection } from "../../redis";
import { elasticSearchEventSchema } from "../../tracer/types.generated";
import { TRACK_EVENTS_QUEUE_NAME } from "../queues/trackEventsQueue";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";

const debug = getDebugger("langwatch:workers:trackEventWorker");

export const startTrackEventsWorker = () => {
  if (!connection) {
    debug("No redis connection, skipping track events worker");
    return;
  }

  const trackEventsWorker = new Worker<TrackEventJob, void, string>(
    TRACK_EVENTS_QUEUE_NAME,
    async (job) => {
      debug(`Processing job ${job.id} with data:`, job.data);
      getJobProcessingCounter("track_event", "processing").inc();
      const start = Date.now();
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
          updated_at: Date.now(),
        },
      };
      // use zod to remove any other keys that may be present but not allowed
      event = elasticSearchEventSchema.parse(event);

      const trace: Partial<ElasticSearchTrace> = {
        trace_id: event.trace_id,
        project_id: event.project_id,
        events: [event],
      };

      await esClient.update({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId: event.trace_id,
          projectId: event.project_id,
        }),
        retry_on_conflict: 10,
        body: {
          script: {
            source: `
              if (ctx._source.events == null) {
                ctx._source.events = [];
              }
              def newEvent = params.newEvent;
              def found = false;
              for (int i = 0; i < ctx._source.events.size(); i++) {
                if (ctx._source.events[i].event_id == newEvent.event_id) {
                  ctx._source.events[i] = newEvent;
                  found = true;
                  break;
                }
              }
              if (!found) {
                if (newEvent.timestamps == null) {
                  newEvent.timestamps = new HashMap();
                }
                newEvent.timestamps.inserted_at = System.currentTimeMillis();
                ctx._source.events.add(newEvent);
              }
            `,
            lang: "painless",
            params: {
              newEvent: event,
            },
          },
          upsert: {
            trace_id: trace.trace_id,
            project_id: trace.project_id,
            timestamps: {
              inserted_at: Date.now(),
              started_at: Date.now(),
              updated_at: Date.now(),
            },
            events: [event],
          },
        },
        refresh: true,
      });
      getJobProcessingCounter("track_event", "completed").inc();
      const duration = Date.now() - start;
      getJobProcessingDurationHistogram("track_event").observe(duration);
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
    getJobProcessingCounter("track_event", "failed").inc();
    Sentry.withScope((scope) => {
      scope.setTag("worker", "trackEvents");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  debug("Track events worker registered");
  return trackEventsWorker;
};
