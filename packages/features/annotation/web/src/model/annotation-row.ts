import { describeAnnotationAnchor, readableAnnotationAnchor } from "@langwatch/annotation-contract";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";

export type AnnotationUser = {
  id: string;
  name: string | null;
  image?: string | null;
};
import { z } from "zod";

export type AnnotationTrace = {
  trace_id: string;
  timestamps?: {
    started_at: number | string;
  };
  input?: { value: string } | null;
  output?: { value: string } | null;
  /**
   * The thread the trace belongs to, which the QUEUE WALKER reads to know which
   * conversation to render around the item. The list never touches it, so it is
   * optional here rather than a widening of what a row is.
   */
  metadata?: { thread_id?: string | null } | null;
};

const scoreAnswerSchema = z.object({
  value: z.unknown().optional(),
  reason: z.unknown().optional(),
});
const scoreAnswersSchema = z.record(z.string(), z.unknown());

export type AnnotationAnchorValue = {
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
};

export type AnnotationSuggestionValue = AnnotationAnchorValue & {
  expectedOutput: string | null;
};

export type AnnotationScoreValue = {
  scoreOptions: unknown;
};

/** The part of a trace an annotation was left on, in words. */
export function annotationAnchorLabel({
  annotation,
  traceId,
}: {
  annotation: AnnotationAnchorValue;
  traceId: string;
}): string | null {
  const anchor = readableAnnotationAnchor(annotation);
  return describeAnnotationAnchor({ anchor, traceId });
}

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

export interface AnnotationScoreAnswer {
  name: string;
  values: string[];
  reason: string | null;
}

function answeredValues(value: unknown): string[] {
  const answers = Array.isArray(value) ? value : [value];
  return answers
    .filter((answer) => answer !== null && answer !== void 0 && answer !== "")
    .map(String);
}

function givenReason(reason: unknown): string | null {
  return typeof reason === "string" && reason ? reason : null;
}

function toScoreAnswer({
  scoreId,
  value,
  scoreNamesById,
}: {
  scoreId: string;
  value: unknown;
  scoreNamesById?: Map<string, string>;
}): AnnotationScoreAnswer | null {
  const parsed = scoreAnswerSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const values = answeredValues(parsed.data.value);
  if (values.length === 0) {
    return null;
  }

  return {
    name: scoreNamesById?.get(scoreId) ?? scoreId,
    values,
    reason: givenReason(parsed.data.reason),
  };
}

export function annotationScores({
  annotation,
  scoreNamesById,
}: {
  annotation: AnnotationScoreValue;
  scoreNamesById?: Map<string, string>;
}): AnnotationScoreAnswer[] {
  const parsed = scoreAnswersSchema.safeParse(annotation.scoreOptions);
  if (!parsed.success) {
    return [];
  }

  return Object.entries(parsed.data)
    .map(([scoreId, value]) => toScoreAnswer({ scoreId, value, scoreNamesById }))
    .filter((score): score is AnnotationScoreAnswer => score !== null);
}

export function countAnnotationScores(annotations: AnnotationScoreValue[]): number {
  return annotations.reduce(
    (total, annotation) => total + annotationScores({ annotation }).length,
    0,
  );
}

export function annotationScoresLine({
  annotation,
  scoreNamesById,
}: {
  annotation: AnnotationScoreValue;
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

export type AnnotationRow = {
  id: string;
  queueItemId: string | null;
  traceId: string;
  occurredAtMs?: number;
  date: Date | null;
  doneAt: Date | null;
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
  const milliseconds = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds) : void 0;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function lastAnnotatedAt(annotations: AnnotationWithUser[]): Date | null {
  let newest: Date | null = null;
  for (const annotation of annotations) {
    const created = toDate(annotation.createdAt);
    if (created && (!newest || created > newest)) {
      newest = created;
    }
  }
  return newest;
}

export type QueueItemLike = {
  id: string;
  traceId: string;
  doneAt?: Date | string | null;
  createdAt?: Date | string | null;
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
    date: toDate(item.createdAt),
    doneAt: toDate(item.doneAt),
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
