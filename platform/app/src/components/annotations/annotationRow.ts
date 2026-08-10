import type { Annotation } from "~/generated/prisma/client";
import { readableAnnotationAnchor } from "~/server/annotations/annotationAnchor";
import { describeAnnotationAnchor } from "~/server/annotations/annotationAnchorLabel";
import type { Trace } from "~/server/tracer/types";

export type AnnotationWithUser = Annotation & {
  user?: {
    name: string | null;
    id: string;
    image?: string | null;
  } | null;
};

/**
 * The part of the trace an annotation was left on, in words, or null when it is
 * about the trace as a whole. The list reads annotations straight from the feed,
 * where an anchor kind this build does not recognise is still stored as written,
 * so the anchor is normalised before it is named: an unreadable kind reads as no
 * anchor rather than as a part of the trace nobody can point at.
 */
export function annotationAnchorLabel({
  annotation,
  traceId,
}: {
  annotation: Pick<Annotation, "anchorKind" | "anchorId" | "anchorPath">;
  traceId: string;
}): string | null {
  return describeAnnotationAnchor({
    anchor: readableAnnotationAnchor(annotation),
    traceId,
  });
}

/**
 * One suggestion as the export writes it: the suggested output, named by the
 * part of the trace it was left on. Empty when the annotation suggested nothing.
 */
export function suggestionExportLine({
  annotation,
  traceId,
}: {
  annotation: Pick<
    Annotation,
    "expectedOutput" | "anchorKind" | "anchorId" | "anchorPath"
  >;
  traceId: string;
}): string {
  if (!annotation.expectedOutput) return "";
  const label = annotationAnchorLabel({ annotation, traceId });
  return label
    ? `${label}: ${annotation.expectedOutput}`
    : annotation.expectedOutput;
}

/** One score a reviewer gave, named the way the project names it. */
export interface AnnotationScoreAnswer {
  /** The score's name, or the id it is stored under when the project dropped it. */
  name: string;
  /** What the reviewer answered. A score can take more than one answer. */
  values: string[];
  reason: string | null;
}

/** What a reviewer answered on one score, blanks dropped. A score takes one
 *  answer or several, and is stored either way. */
function answeredValues(value: unknown): string[] {
  const answers = Array.isArray(value) ? value : [value];
  return answers
    .filter(
      (answer) => answer !== null && answer !== undefined && answer !== "",
    )
    .map(String);
}

/** The reason a reviewer wrote for a score, or nothing when they wrote none. */
function givenReason(reason: unknown): string | null {
  return typeof reason === "string" && reason ? reason : null;
}

/**
 * The scores one reviewer gave, in the order they are stored. A key the
 * reviewer left blank is not a score they gave, so it is left out entirely.
 */
export function annotationScores({
  annotation,
  scoreNamesById,
}: {
  annotation: Pick<Annotation, "scoreOptions">;
  /** The project's score names by id. Without it a score reads by its id. */
  scoreNamesById?: Map<string, string>;
}): AnnotationScoreAnswer[] {
  const stored = annotation.scoreOptions as Record<
    string,
    { value?: unknown; reason?: unknown } | null
  > | null;
  if (!stored || typeof stored !== "object") return [];

  return Object.entries(stored)
    .map(([scoreId, score]) => ({
      name: scoreNamesById?.get(scoreId) ?? scoreId,
      values: answeredValues(score?.value),
      reason: givenReason(score?.reason),
    }))
    .filter((score) => score.values.length > 0);
}

/** Every score given on the trace, across its reviews. */
export function countAnnotationScores(
  annotations: Array<Pick<Annotation, "scoreOptions">>,
): number {
  return annotations.reduce(
    (total, annotation) => total + annotationScores({ annotation }).length,
    0,
  );
}

/**
 * One reviewer's scores as a single line: what they answered on each score,
 * with the reason they gave for it. Empty when they scored nothing.
 */
export function annotationScoresLine({
  annotation,
  scoreNamesById,
}: {
  annotation: Pick<Annotation, "scoreOptions">;
  scoreNamesById?: Map<string, string>;
}): string | null {
  const scores = annotationScores({ annotation, scoreNamesById });
  if (scores.length === 0) return null;
  return scores
    .map((score) => {
      const answered = `${score.name}: ${score.values.join(", ")}`;
      return score.reason ? `${answered} (${score.reason})` : answered;
    })
    .join(" · ");
}

/**
 * One line of the annotations list, whichever page it is on. A queue page's row
 * is a queue item; the all annotations page's row is a trace with everything
 * said about it, and carries no queue item.
 */
export type AnnotationRow = {
  /** Row identity for selection: the queue item, or the trace where there is none. */
  id: string;
  /** Null on the all annotations page, where a row is not queued work. */
  queueItemId: string | null;
  traceId: string;
  /** Trace start in ms, forwarded to the drawer as its partition hint. */
  occurredAtMs?: number;
  /** What the row's date column shows: queued at, or last annotated at. */
  date: Date | null;
  doneAt: Date | null;
  createdByUser: {
    name: string | null;
    id: string;
    image?: string | null;
  } | null;
  trace?: Trace;
  annotations: AnnotationWithUser[];
};

/**
 * Coerce a trace `started_at` value into a numeric ms partition hint, or
 * undefined. The field is typed numeric but upstream sources have at times
 * carried an ISO string; normalize both so the hint stays a valid integer for
 * the `z.number().int()` query contract and the drawer's `t` URL param.
 */
export function toOccurredAtMsHint(
  startedAt: number | string | null | undefined,
): number | undefined {
  if (startedAt === null || startedAt === undefined) return undefined;
  const ms = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : undefined;
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The newest annotation's creation date, which is when the row was last judged. */
export function lastAnnotatedAt(
  annotations: AnnotationWithUser[],
): Date | null {
  let newest: Date | null = null;
  for (const annotation of annotations) {
    const created = toDate(annotation.createdAt);
    if (created && (!newest || created > newest)) newest = created;
  }
  return newest;
}

type QueueItemLike = {
  id: string;
  traceId: string;
  doneAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdByUser?: {
    name: string | null;
    id: string;
    image?: string | null;
  } | null;
  trace?: Trace | null;
  annotations?: AnnotationWithUser[] | null;
};

/** Queue items as the list reads them: dated by when the item was queued. */
export function queueItemsToRows(items: QueueItemLike[]): AnnotationRow[] {
  return items.map((item) => ({
    id: item.id,
    queueItemId: item.id,
    traceId: item.traceId,
    occurredAtMs: toOccurredAtMsHint(item.trace?.timestamps?.started_at),
    date: toDate(item.createdAt),
    doneAt: toDate(item.doneAt),
    createdByUser: item.createdByUser ?? null,
    trace: item.trace ?? undefined,
    annotations: item.annotations ?? [],
  }));
}

type GroupedAnnotation = {
  traceId: string;
  trace?: Trace;
  annotations: AnnotationWithUser[];
};

/**
 * Traces with everything said about them, as the all annotations page reads
 * them: dated by the newest annotation, and with no queue item behind them.
 */
export function groupedAnnotationsToRows(
  groups: GroupedAnnotation[],
): AnnotationRow[] {
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
