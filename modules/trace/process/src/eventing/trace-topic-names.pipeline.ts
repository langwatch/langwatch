/**
 * Trace folds topic's `topics_recorded` fact into its own `trace_topic_names` (round 23), so the
 * trace list labels topic facets with no topic peer.
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import type { TraceModule } from "../app/trace.app.ts";
import type { TraceTopicNamesFoldState } from "../repositories/trace-topic-names.repository.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import {
  TRACE_TOPIC_NAMES_PROJECTION_NAME,
  traceTopicNamesPeerFold,
} from "./trace-topic-names.projection.ts";

export const TRACE_TOPIC_NAMES_PIPELINE_NAME = "trace_topic_names" as const;

/** The replayable lane, `<pipeline>.<projection>`, an operator or a replay step rebuilds. */
export const TRACE_TOPIC_NAMES_LANE =
  `${TRACE_TOPIC_NAMES_PIPELINE_NAME}.${TRACE_TOPIC_NAMES_PROJECTION_NAME}` as const;

function traceTopicNamesHost(store: FoldProjectionStore<TraceTopicNamesFoldState>) {
  return definePipeline({
    name: TRACE_TOPIC_NAMES_PIPELINE_NAME,
    // `global`: trace appends no events of its own here; it only folds topic's.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerFoldProjection(traceTopicNamesPeerFold(store));
}

export type TraceTopicNamesPipeline = ReturnType<ReturnType<typeof traceTopicNamesHost>["build"]>;

export function buildTraceTopicNamesPipeline(
  store: FoldProjectionStore<TraceTopicNamesFoldState>,
): TraceTopicNamesPipeline {
  return traceTopicNamesHost(store).build();
}

export const traceTopicNamesEventing = defineEventingModule({
  pipeline: TRACE_TOPIC_NAMES_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<TraceRepositories, TraceModule>) =>
    buildTraceTopicNamesPipeline(repositories.topicNames),
});
