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
}: {
  anchor: AnnotationAnchorRef;
  /** The trace the comment is on, which tells its own fields from a span's. */
  traceId: string;
  /** The name of the span the comment is on, when the caller knows it. */
  spanName?: string | null;
}): string | null {
  const { anchorKind, anchorId, anchorPath } = anchor;
  if (!anchorKind || !anchorId) return null;

  if (anchorKind === "message") return "Message";

  const isTraceItself = anchorId === traceId;
  const owner = isTraceItself ? "Trace" : `Span ${spanName ?? anchorId}`;

  if (anchorKind === "span") return owner;

  const path = describeFieldPath(anchorPath);
  return path ? `${owner}${SEPARATOR}${path}` : owner;
}

/**
 * A field path as its segments read: the ones this build names get their name,
 * and a key inside one of them reads as the reader wrote it.
 */
function describeFieldPath(anchorPath: string | null): string | null {
  if (!anchorPath) return null;
  return anchorPath
    .split(".")
    .map((segment) => FIELD_LABELS[segment] ?? segment)
    .join(SEPARATOR);
}
