import {
  annotationScores,
  describeAnnotationAnchor,
  readableAnnotationAnchor,
  type AnnotationAnchorStorage,
  type AnnotationWithUser,
  type ScoredAnnotation,
} from "@langwatch/annotation-contract";
import { Temporal, toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

export {
  annotationScores,
  countAnnotationScores,
  type AnnotationScoreAnswer,
} from "@langwatch/annotation-contract";

export type DisplayMoment = Instant;

export type AnnotationUser = {
  id: string;
  name: string | null;
  image?: string | null;
};

export type AnnotationTrace = {
  trace_id: string;
  timestamps?: {
    started_at: number | string;
  };
  input?: { value: string } | null;
  output?: { value: string } | null;
  /** Read by the queue walker only, to pick the conversation around an item. */
  metadata?: { thread_id?: string | null } | null;
};

/** The part of a trace an annotation was left on, in words. */
export function annotationAnchorLabel({
  annotation,
  traceId,
}: {
  annotation: AnnotationAnchorStorage;
  traceId: string;
}): string | null {
  return describeAnnotationAnchor({ anchor: readableAnnotationAnchor(annotation), traceId });
}

export function annotationScoresLine({
  annotation,
  scoreNamesById,
}: {
  annotation: ScoredAnnotation;
  scoreNamesById?: Map<string, string>;
}): string | null {
  const scores = annotationScores({ annotation, scoreNamesById });

  if (scores.length === 0) {
    return null;
  }

  return scores
    .map((score) => {
      const answered = `${score.name}: ${score.values.join(", ")}`;

      return score.reason ? `${answered} (${score.reason})` : answered;
    })
    .join(" · ");
}

export type AnnotationSuggestionValue = AnnotationAnchorStorage & {
  expectedOutput: string | null;
};

export function suggestionExportLine({
  annotation,
  traceId,
}: {
  annotation: AnnotationSuggestionValue;
  traceId: string;
}): string {
  if (!annotation.expectedOutput) {
    return "";
  }

  const label = annotationAnchorLabel({ annotation, traceId });

  return label ? `${label}: ${annotation.expectedOutput}` : annotation.expectedOutput;
}

export function annotationRatingExportLabel(isThumbsUp: boolean | null | undefined): string {
  if (isThumbsUp === true) {
    return "Thumbs Up";
  }

  if (isThumbsUp === false) {
    return "Thumbs Down";
  }

  return "";
}

export type AnnotationRow = {
  id: string;
  queueItemId: string | null;
  traceId: string;
  occurredAtMs?: number;
  date: DisplayMoment | null;
  doneAt: DisplayMoment | null;
  createdByUser: AnnotationUser | null;
  trace?: AnnotationTrace;
  annotations: AnnotationWithUser[];
};

export function toOccurredAtMsHint(
  startedAt: number | string | null | undefined,
): number | undefined {
  if (startedAt === null || startedAt === void 0) {
    return void 0;
  }

  const milliseconds = typeof startedAt === "number" ? startedAt : toEpochMs(startedAt);

  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds) : void 0;
}

function readMoment(value: TimeInput | null | undefined): DisplayMoment | null {
  if (!value) {
    return null;
  }

  const milliseconds = toEpochMs(value);

  return Number.isFinite(milliseconds)
    ? Temporal.Instant.fromEpochMilliseconds(milliseconds)
    : null;
}

export function lastAnnotatedAt(annotations: AnnotationWithUser[]): DisplayMoment | null {
  let newest: DisplayMoment | null = null;

  for (const annotation of annotations) {
    const created = readMoment(annotation.createdAt);

    if (created && (!newest || Temporal.Instant.compare(created, newest) > 0)) {
      newest = created;
    }
  }

  return newest;
}

export type QueueItemLike = {
  id: string;
  traceId: string;
  doneAt?: TimeInput | null;
  createdAt?: TimeInput | null;
  createdByUser?: AnnotationUser | null;
  trace?: AnnotationTrace | null;
  annotations?: AnnotationWithUser[] | null;
};

export function queueItemsToRows(items: QueueItemLike[]): AnnotationRow[] {
  return items.map((item) => ({
    id: item.id,
    queueItemId: item.id,
    traceId: item.traceId,
    occurredAtMs: toOccurredAtMsHint(item.trace?.timestamps?.started_at),
    date: readMoment(item.createdAt),
    doneAt: readMoment(item.doneAt),
    createdByUser: item.createdByUser ?? null,
    trace: item.trace ?? void 0,
    annotations: item.annotations ?? [],
  }));
}

type GroupedAnnotation = {
  traceId: string;
  trace?: AnnotationTrace;
  annotations: AnnotationWithUser[];
};

export function groupedAnnotationsToRows(groups: GroupedAnnotation[]): AnnotationRow[] {
  return groups.map((group) => ({
    id: group.traceId,
    queueItemId: null,
    traceId: group.traceId,
    occurredAtMs: toOccurredAtMsHint(group.trace?.timestamps?.started_at),
    date: lastAnnotatedAt(group.annotations),
    doneAt: null,
    createdByUser: null,
    trace: group.trace,
    annotations: group.annotations,
  }));
}
