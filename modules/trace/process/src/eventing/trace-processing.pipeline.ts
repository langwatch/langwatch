import {
  defineEventingModule,
  throttledWindow,
  type EventingSetup,
  type LaneAlias,
  type TriggerContext,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { TraceModule } from "../app/trace.app.ts";
import {
  DEFERRED_ORIGIN_DEDUP,
  DEFERRED_ORIGIN_DELAY_MS,
  DEFERRED_ORIGIN_SUBSCRIBER_NAME,
  needsOriginResolution,
} from "./deferred-origin.subscriber.ts";
import {
  PROJECT_METADATA_WINDOW_MS,
  isRealFirstIngest,
  projectMetadataGroupKey,
} from "./project-metadata.subscriber.ts";
import { SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS } from "./span-storage-broadcast.subscriber.ts";
import type {
  TraceProcessingPipelineDefinition,
  EventingTracePipelineAdapter,
} from "./trace-processing-projections.pipeline.ts";
import { TRACE_UPDATE_BROADCAST_WINDOW_MS } from "./trace-update-broadcast.subscriber.ts";
import {
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  hasSyncableFeedback,
  trackedEventSyncDedupId,
} from "./tracked-event-sync.subscriber.ts";

type SummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

/** Every reaction main's worker hung on trace_processing, keyed by its queued name. */
interface TraceProcessingReactions {
  resolveDeferredOrigin: (payload: { tenantId: string; traceId: string }) => Promise<void>;
  trackedEventSync: SummaryHandler;
  traceUpdateBroadcast: SummaryHandler;
  projectMetadata: SummaryHandler;
  spanStorageBroadcast: (
    event: TraceProcessingEvent,
    context: TriggerContext<unknown>,
  ) => Promise<void>;
  broadcastDisabled: boolean;
}

const deferredOriginJobSchema = z.object({ tenantId: z.string(), traceId: z.string() });

/**
 * Main's origin gate was a reactor of another name, and its delayed job a job lane. The job only
 * ever sent `resolveOrigin`, so a job still queued sends it with the fallback main's handler used.
 */
const MAIN_ORIGIN_LANE_ALIASES: readonly LaneAlias[] = [
  {
    from: "trace_processing:reactor:originGate",
    to: { jobType: "reactor", lane: DEFERRED_ORIGIN_SUBSCRIBER_NAME },
    removeAfter: "3.21.0",
  },
  {
    from: "trace_processing:job:deferredOriginResolution",
    to: { jobType: "command", lane: "resolveOrigin" },
    data: (stored) => {
      const { tenantId, traceId } = deferredOriginJobSchema.parse(stored);
      return {
        tenantId,
        traceId,
        origin: "application",
        reason: "deferred_fallback",
        occurredAt: nowInstant().epochMilliseconds,
      };
    },
    removeAfter: "3.21.0",
  },
];

/** The consuming definition: projections and main's subscribers, deferred origin included. */
export function buildTraceProcessingConsumer(
  projections: ReturnType<EventingTracePipelineAdapter["build"]>,
  reactions: TraceProcessingReactions,
): TraceProcessingPipelineDefinition {
  return projections
    .withProjectionSubscriber(DEFERRED_ORIGIN_SUBSCRIBER_NAME, {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: (event, context) => needsOriginResolution({ event, foldState: context.state }),
      delay: DEFERRED_ORIGIN_DELAY_MS,
      dedup: DEFERRED_ORIGIN_DEDUP,
      handler: (_event, context) =>
        reactions.resolveDeferredOrigin({
          tenantId: context.tenantId,
          traceId: context.aggregateId,
        }),
    })
    .withProjectionSubscriber("trackedEventSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: (event) => hasSyncableFeedback(event),
      delay: TRACKED_EVENT_SYNC_DELAY_MS,
      ttl: TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
      dedupId: (event) => trackedEventSyncDedupId(event),
      handler: (event, context) => reactions.trackedEventSync(event, context),
    })
    .withProjectionSubscriber("traceUpdateBroadcast", {
      fold: "traceSummary",
      runIn: ["worker"],
      disabled: reactions.broadcastDisabled,
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
        windowMs: TRACE_UPDATE_BROADCAST_WINDOW_MS,
      }),
      handler: (event, context) => reactions.traceUpdateBroadcast(event, context),
    })
    .withProjectionSubscriber("projectMetadata", {
      fold: "traceSummary",
      runIn: ["worker"],
      when: (_event, context) => isRealFirstIngest(context.state),
      groupKeyFn: (event) => projectMetadataGroupKey(event),
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => event.tenantId,
        windowMs: PROJECT_METADATA_WINDOW_MS,
      }),
      handler: (event, context) => reactions.projectMetadata(event, context),
    })
    .withProjectionSubscriber("spanStorageBroadcast", {
      map: "spanStorage",
      runIn: ["worker"],
      disabled: reactions.broadcastDisabled,
      ttl: SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
      handler: (event, context) => reactions.spanStorageBroadcast(event, context),
    })
    .withLaneAliases(MAIN_ORIGIN_LANE_ALIASES)
    .build();
}

/** trace_processing, built by the app in both roles; its senders carry every trace write. */
export const traceProcessingEventing = defineEventingModule({
  pipeline: "trace_processing",
  build: ({ app, participation }: EventingSetup<never, TraceModule>) =>
    app.traceProcessingPipeline({ participation }),
  connect: ({ app, commands }) => app.connectTraceProcessingCommands(commands),
});
