import type { Annotation } from "@prisma/client";
import type { Trace } from "~/server/tracer/types";

export type AnnotationWithUser = Annotation & {
  user?: {
    name: string | null;
    id: string;
    image?: string | null;
  } | null;
};

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
