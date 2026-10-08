import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
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

import type { AnalyticsModule } from "../app/analytics.app.ts";
import type { AnalyticsRepositories } from "../repositories/analytics.repositories.ts";
import {
  type TraceAnalyticsRollupRow,
  TraceAnalyticsRollupMapProjection,
} from "./trace-analytics-rollup.projection.ts";
import { TraceAnalyticsRollupStore } from "./trace-analytics-rollup.store.ts";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "./trace-analytics.projection.ts";
import { TraceAnalyticsStore } from "./trace-analytics.store.ts";

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

/** The retention peer's two reads the host lanes stamp each row's TTL with. */
export type TraceAnalyticsRetention = Pick<
  DataRetentionApi,
  "getPlatformDefaultRetentionDays" | "getResolvedForProject"
>;

/** The three repositories behind the host's two lanes. */
export type TraceAnalyticsRepositories = Pick<
  AnalyticsRepositories,
  "traceAnalyticsProjection" | "traceAnalyticsRollup" | "traceAnalyticsFoldCache"
>;

/** The stores trace's runtime built, and the host's retention its peer lanes take (round 20). */
export function buildTraceAnalyticsPipeline({
  repositories,
  retention,
}: {
  repositories: TraceAnalyticsRepositories;
  retention: TraceAnalyticsRetention;
}): TraceAnalyticsPipeline {
  const defaultRetentionDays = (): number => retention.getPlatformDefaultRetentionDays();
  return traceAnalyticsHost({
    foldStore: repositories.traceAnalyticsFoldCache.cached(
      TraceAnalyticsStore.create({
        storage: repositories.traceAnalyticsProjection,
        defaultRetentionDays,
      }),
    ),
    rollupStore: TraceAnalyticsRollupStore.create({
      storage: repositories.traceAnalyticsRollup,
      defaultRetentionDays,
    }),
  })
    .withRetention({
      resolve: (tenantId) => retention.getResolvedForProject({ projectId: tenantId }),
    })
    .build();
}

export const traceAnalyticsEventing = defineEventingModule({
  pipeline: TRACE_ANALYTICS_PIPELINE_NAME,
  build: ({ app, repositories }: EventingSetup<AnalyticsRepositories, AnalyticsModule>) =>
    app.traceAnalyticsPipeline({ repositories }),
});
