import type { AnnotationAnchorKind } from "~/server/annotations/annotationAnchor";

/** The part of a trace a comment was left on, as it is stored. */
export interface AnnotationAnchorRef {
  anchorKind: AnnotationAnchorKind | null;
  anchorId: string | null;
  anchorPath: string | null;
}

/**
 * What the reader calls each field a comment can be left on. Anything else in a
 * path is a key the reader chose themselves, and reads as they wrote it.
 */
const FIELD_LABELS: Record<string, string> = {
  error: "Error",
  input: "Input",
  metadata: "Metadata",
  name: "Name",
  output: "Output",
  params: "Parameters",
  type: "Type",
};

/** Between the parts of what a comment is about, in the order a reader reads them. */
const SEPARATOR = " · ";

/** As much of an id as a reader needs to match it against what is on screen. */
const shortId = (id: string): string => id.slice(0, 8);

/**
 * What a comment is about, in words. Null when it is about the trace as a
 * whole, which is what a card with nothing named on it means.
 *
 * A span reads by its name when the caller has one and by its id when it does
 * not, because an id the reader can match against the waterfall still beats
 * "a span". A message reads as a message: the key it is stored against is how
 * the transcript finds it again, not something to show anyone.
 */
export function describeAnnotationAnchor({
  anchor,
  traceId,
  spanName,
  selfLabel = "Trace",
  withIds = false,
}: {
  anchor: AnnotationAnchorRef;
  /** The trace the comment is on, which tells its own fields from a span's. */
  traceId: string;
  /** The name of the span the comment is on, when the caller knows it. */
  spanName?: string | null;
  /**
   * What the trace itself is called in front of its own fields. `null` leaves
   * it out, for a caller already reading that trace: a card beside a turn says
   * "Output", because "Trace · Output" repeats the turn it is sitting next to.
   */
  selfLabel?: string | null;
  /**
   * Name the trace and the span by id as well, and say "<name> span" rather
   * than "Span <name>". For a line that leaves the product, a dataset row or an
   * export, where the reader has no waterfall in front of them and a name alone
   * is ambiguous the moment two spans share it. On screen it is noise: the
   * reader is already looking at the trace the comment is on.
   */
  withIds?: boolean;
}): string | null {
  const { anchorKind, anchorId, anchorPath } = anchor;
  if (!anchorKind || !anchorId) return null;

  if (anchorKind === "message") return "Message";

  const owner = describeAnchorOwner({
    anchorId,
    traceId,
    spanName,
    selfLabel,
    withIds,
  });

  if (anchorKind === "span") return owner;

  const path = describeFieldPath(anchorPath);
  if (!owner) return path;
  return path ? `${owner}${SEPARATOR}${path}` : owner;
}

/** Whose field the comment is on: the trace itself, or one of its spans. */
function describeAnchorOwner({
  anchorId,
  traceId,
  spanName,
  selfLabel,
  withIds,
}: {
  anchorId: string;
  traceId: string;
  spanName?: string | null;
  selfLabel: string | null;
  withIds: boolean;
}): string | null {
  if (anchorId === traceId) {
    if (!selfLabel) return null;
    return withIds ? `${selfLabel} (${shortId(traceId)})` : selfLabel;
  }
  if (!withIds) return `Span ${spanName ?? anchorId}`;
  return spanName
    ? `${spanName} span (${shortId(anchorId)})`
    : `span (${shortId(anchorId)})`;
}

/**
 * A field path as it reads: the field this build names gets its name, and the
 * key inside it reads exactly as the reader wrote it. Only the first segment is
 * a field of ours, so `params.gen_ai.request.model` is the reader's own
 * `gen_ai.request.model` under Parameters, not four separate steps.
 */
function describeFieldPath(anchorPath: string | null): string | null {
  if (!anchorPath) return null;
  const separatorAt = anchorPath.indexOf(".");
  if (separatorAt === -1) {
    return FIELD_LABELS[anchorPath] ?? anchorPath;
  }
  const field = anchorPath.slice(0, separatorAt);
  const key = anchorPath.slice(separatorAt + 1);
  return `${FIELD_LABELS[field] ?? field}${SEPARATOR}${key}`;
}
