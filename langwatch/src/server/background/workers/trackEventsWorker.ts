import { type Job, Worker } from "bullmq";
import { createWorkerTelemetry } from "../bullmqTelemetry";
import type { TrackEventJob } from "~/server/background/types";
import { withJobContext } from "../../context/asyncContext";
import type {
  ElasticSearchEvent,
  ElasticSearchTrace,
} from "../../../server/tracer/types";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import { esClient, TRACE_INDEX, traceIndexId } from "../../elasticsearch";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import { elasticSearchEventSchema } from "../../tracer/types.generated";
import { TRACK_EVENTS_QUEUE } from "../queues/trackEventsQueue";

const logger = createLogger("langwatch:workers:trackEventWorker");

export async function runTrackEventJob(job: Job<TrackEventJob, void, string>) {
  recordJobWaitDuration(job, "track_events");
  logger.info({ jobId: job.id, data: job.data }, "processing job");
  getJobProcessingCounter("track_events", "processing").inc();
  const start = Date.now();
  let event: ElasticSearchEvent = {
    ...job.data.event,
    project_id: job.data.project_id,
    metrics: Object.entries(job.data.event.metrics).map(([key, value]) => ({
      key,
      value,
    })),
    event_details: job.data.event.event_details
      ? Object.entries(job.data.event.event_details)
          .filter(([, value]) => value != null)
          .map(([key, value]) => ({
            key,
            value: value!,
          }))
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

  const client = await esClient({ projectId: event.project_id });

  await client.update({
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
  getJobProcessingCounter("track_events", "completed").inc();
  const duration = Date.now() - start;
  getJobProcessingDurationHistogram("track_events").observe(duration);
}

export const startTrackEventsWorker = () => {
  if (!connection) {
    logger.info(" no redis connection, skipping track events worker");
    return;
  }

  const trackEventsWorker = new Worker<TrackEventJob, void, string>(
    TRACK_EVENTS_QUEUE.NAME,
    withJobContext(runTrackEventJob),
    {
      connection,
      concurrency: 3,
      telemetry: createWorkerTelemetry(TRACK_EVENTS_QUEUE.NAME),
    },
  );

  trackEventsWorker.on("ready", () => {
    logger.info("track event worker active, waiting for jobs!");
  });

  trackEventsWorker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("track_events", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "trackEvents");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("track events worker registered");
  return trackEventsWorker;
};
