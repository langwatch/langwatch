/**
 * Trace's copy of annotations and score names: two peer folds (§9, EF-1) over annotation's facts.
 * The newest `updatedAt` wins; a delete is a tombstone nothing revives (a backfill racing a delete
 * can append created after deleted). Spec: modules/trace/specs/trace-annotations.feature
 */
import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
  type AnnotationContentEventData,
  annotationCreatedEventDataSchema,
  annotationDeletedEventDataSchema,
  annotationScoreDefinedEventDataSchema,
  annotationScoreRenamedEventDataSchema,
  annotationUpdatedEventDataSchema,
} from "@langwatch/annotation-contract";
import type {
  FoldProjectionStore,
  PeerEvent,
  PeerFoldProjectionDeclaration,
} from "@langwatch/eventing";

import {
  TRACE_ANNOTATION_SCORES_PROJECTION_VERSION,
  type TraceAnnotationScoreFoldState,
} from "../repositories/trace-annotation-scores.repository.ts";
import {
  TRACE_ANNOTATIONS_PROJECTION_VERSION,
  type TraceAnnotationFoldState,
} from "../repositories/trace-annotations.repository.ts";

/** The folds' names; their global lanes are `<host pipeline>.<name>`. */
export const TRACE_ANNOTATIONS_PROJECTION_NAME = "annotations" as const;
export const TRACE_ANNOTATION_SCORES_PROJECTION_NAME = "annotationScores" as const;

/** Annotation's row facts, parsed by annotation-contract's own schemas. */
export const traceAnnotationPeerEvents = [
  { type: ANNOTATION_CREATED_EVENT_TYPE, data: annotationCreatedEventDataSchema },
  { type: ANNOTATION_UPDATED_EVENT_TYPE, data: annotationUpdatedEventDataSchema },
  { type: ANNOTATION_DELETED_EVENT_TYPE, data: annotationDeletedEventDataSchema },
] as const;

/** Annotation's score-definition facts. */
export const traceAnnotationScorePeerEvents = [
  { type: ANNOTATION_SCORE_DEFINED_EVENT_TYPE, data: annotationScoreDefinedEventDataSchema },
  { type: ANNOTATION_SCORE_RENAMED_EVENT_TYPE, data: annotationScoreRenamedEventDataSchema },
] as const;

export type TraceAnnotationPeerEvent = PeerEvent<typeof traceAnnotationPeerEvents>;
export type TraceAnnotationScorePeerEvent = PeerEvent<typeof traceAnnotationScorePeerEvents>;

function contentOf(data: AnnotationContentEventData): TraceAnnotationFoldState["content"] {
  return {
    comment: data.comment,
    isThumbsUp: data.isThumbsUp,
    expectedOutput: data.expectedOutput,
    scoreOptions: data.scoreOptions,
    anchorKind: data.anchorKind,
    anchorId: data.anchorId,
    anchorPath: data.anchorPath,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/** One annotation fact over trace's copy: deleted is terminal, then the newest content wins. */
export function foldTraceAnnotation(
  state: TraceAnnotationFoldState,
  event: TraceAnnotationPeerEvent,
): TraceAnnotationFoldState {
  const base = {
    ...state,
    annotationId: event.data.annotationId,
    traceId: event.data.traceId,
    revision: state.revision + 1,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
  if (event.type === ANNOTATION_DELETED_EVENT_TYPE) return { ...base, deleted: true };
  if (state.deleted) return { ...base, traceId: state.traceId };
  if (state.content && event.data.updatedAt < state.content.updatedAt) return base;
  return { ...base, content: contentOf(event.data) };
}

/** One score-definition fact: the name with the newest instant wins, so a rename sticks. */
export function foldTraceAnnotationScore(
  state: TraceAnnotationScoreFoldState,
  event: TraceAnnotationScorePeerEvent,
): TraceAnnotationScoreFoldState {
  const newer = state.name === null || event.data.occurredAt >= state.namedAt;
  return {
    scoreId: event.data.scoreId,
    name: newer ? event.data.name : state.name,
    namedAt: newer ? event.data.occurredAt : state.namedAt,
    revision: state.revision + 1,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
}

export function traceAnnotationsPeerFold(
  store: FoldProjectionStore<TraceAnnotationFoldState>,
): PeerFoldProjectionDeclaration<TraceAnnotationFoldState, typeof traceAnnotationPeerEvents> {
  return {
    events: traceAnnotationPeerEvents,
    fold: {
      name: TRACE_ANNOTATIONS_PROJECTION_NAME,
      version: TRACE_ANNOTATIONS_PROJECTION_VERSION,
      eventTypes: traceAnnotationPeerEvents.map(({ type }) => type),
      init: () => ({
        annotationId: "",
        traceId: "",
        content: null,
        deleted: false,
        revision: 0,
        LastEventOccurredAt: 0,
      }),
      apply: foldTraceAnnotation,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}

export function traceAnnotationScoresPeerFold(
  store: FoldProjectionStore<TraceAnnotationScoreFoldState>,
): PeerFoldProjectionDeclaration<
  TraceAnnotationScoreFoldState,
  typeof traceAnnotationScorePeerEvents
> {
  return {
    events: traceAnnotationScorePeerEvents,
    fold: {
      name: TRACE_ANNOTATION_SCORES_PROJECTION_NAME,
      version: TRACE_ANNOTATION_SCORES_PROJECTION_VERSION,
      eventTypes: traceAnnotationScorePeerEvents.map(({ type }) => type),
      init: () => ({ scoreId: "", name: null, namedAt: 0, revision: 0, LastEventOccurredAt: 0 }),
      apply: foldTraceAnnotationScore,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}
