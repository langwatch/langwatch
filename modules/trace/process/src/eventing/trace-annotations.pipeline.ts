/**
 * Trace folds annotation's facts into its own `trace_annotations` and `trace_annotation_scores`
 * (round 24, EF-1), so trace's legacy read holds no annotation peer.
 * Spec: modules/trace/specs/trace-annotations.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import type { TraceModule } from "../app/trace.app.ts";
import type { TraceAnnotationScoreFoldState } from "../repositories/trace-annotation-scores.repository.ts";
import type { TraceAnnotationFoldState } from "../repositories/trace-annotations.repository.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import {
  TRACE_ANNOTATION_SCORES_PROJECTION_NAME,
  TRACE_ANNOTATIONS_PROJECTION_NAME,
  traceAnnotationScoresPeerFold,
  traceAnnotationsPeerFold,
} from "./trace-annotations.projection.ts";

export const TRACE_ANNOTATIONS_PIPELINE_NAME = "trace_annotations" as const;

/** The replayable lanes, `<pipeline>.<projection>`, an operator or a replay step rebuilds. */
export const TRACE_ANNOTATIONS_LANE =
  `${TRACE_ANNOTATIONS_PIPELINE_NAME}.${TRACE_ANNOTATIONS_PROJECTION_NAME}` as const;
export const TRACE_ANNOTATION_SCORES_LANE =
  `${TRACE_ANNOTATIONS_PIPELINE_NAME}.${TRACE_ANNOTATION_SCORES_PROJECTION_NAME}` as const;

function traceAnnotationsHost({
  annotations,
  scores,
}: {
  annotations: FoldProjectionStore<TraceAnnotationFoldState>;
  scores: FoldProjectionStore<TraceAnnotationScoreFoldState>;
}) {
  return definePipeline({
    name: TRACE_ANNOTATIONS_PIPELINE_NAME,
    // `global`: trace appends no events of its own here; it only folds annotation's.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerFoldProjection(traceAnnotationsPeerFold(annotations))
    .withPeerFoldProjection(traceAnnotationScoresPeerFold(scores));
}

export type TraceAnnotationsPipeline = ReturnType<ReturnType<typeof traceAnnotationsHost>["build"]>;

export function buildTraceAnnotationsPipeline(stores: {
  annotations: FoldProjectionStore<TraceAnnotationFoldState>;
  scores: FoldProjectionStore<TraceAnnotationScoreFoldState>;
}): TraceAnnotationsPipeline {
  return traceAnnotationsHost(stores).build();
}

export const traceAnnotationsEventing = defineEventingModule({
  pipeline: TRACE_ANNOTATIONS_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<TraceRepositories, TraceModule>) =>
    buildTraceAnnotationsPipeline({
      annotations: repositories.annotations,
      scores: repositories.annotationScores,
    }),
});
