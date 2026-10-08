import {
  type AppendStore,
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
} from "@langwatch/trace-contract";
import type { z } from "zod";

import {
  type TraceAnalyticsRollupRow,
  TraceAnalyticsRollupMapProjection,
} from "./trace-analytics-rollup.projection.ts";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "./trace-analytics.projection.ts";

/** Hosts analytics' peer fold and map over trace's facts (round 8, named in round 18). */
export const TRACE_ANALYTICS_PIPELINE_NAME = "trace_analytics" as const;

/** One trace fact as a peer projection names it: its type and its contract data schema. */
function peerEventOf<Type extends string, Data extends z.ZodType>(schema: {
  shape: { type: z.ZodLiteral<Type>; data: Data };
}): { type: Type; data: Data } {
  return { type: schema.shape.type.value, data: schema.shape.data };
}

/** The ten trace facts the slim fold reads, as trace's own fold registered them. */
const TRACE_ANALYTICS_FOLD_EVENTS = [
  peerEventOf(spanReceivedEventSchema),
  peerEventOf(topicAssignedEventSchema),
  peerEventOf(logRecordReceivedEventSchema),
  peerEventOf(logContributedEventSchema),
  peerEventOf(metricDataPointCorrelatedEventSchema),
  peerEventOf(originResolvedEventSchema),
  peerEventOf(annotationAddedEventSchema),
  peerEventOf(annotationRemovedEventSchema),
  peerEventOf(annotationsBulkSyncedEventSchema),
  peerEventOf(traceNameChangedEventSchema),
] as const;

function traceAnalyticsHost({
  foldStore,
  rollupStore,
}: {
  foldStore: FoldProjectionStore<TraceAnalyticsData>;
  rollupStore: AppendStore<TraceAnalyticsRollupRow>;
}) {
  return definePipeline({
    name: TRACE_ANALYTICS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "trace_analytics_view" }),
  })
    .withEvents([])
    .withPeerFoldProjection({
      events: TRACE_ANALYTICS_FOLD_EVENTS,
      fold: TraceAnalyticsFoldProjection.create({ store: foldStore }),
    })
    .withPeerMapProjection({
      events: [peerEventOf(spanReceivedEventSchema)] as const,
      map: TraceAnalyticsRollupMapProjection.create({ store: rollupStore }),
    });
}

/** The host pipeline as a TYPE, derived from the builder above. */
export type TraceAnalyticsPipeline = ReturnType<ReturnType<typeof traceAnalyticsHost>["build"]>;

/** Not installed yet: the switch retires trace's two lanes in the same change (handoff ta-host). */
export function buildTraceAnalyticsPipeline(stores: {
  foldStore: FoldProjectionStore<TraceAnalyticsData>;
  rollupStore: AppendStore<TraceAnalyticsRollupRow>;
}): TraceAnalyticsPipeline {
  return traceAnalyticsHost(stores).build();
}
