import type { Protections } from "~/server/traces/protections";
import {
  redactPatchForViewer,
  type TraceMetadataEdits,
} from "./redactTraceEditOverlayPatch";
import {
  TRACE_EDIT_SPAN_FIELDS,
  TRACE_EDIT_TRACE_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
} from "./traceEditOverlay.schemas";

/**
 * The span fields the stored correction holds that this viewer never received
 * faithfully: either dropped outright or handed over with a redaction
 * placeholder in place of the value. Identity comparison is exactly the test:
 * every gate in the read passes a readable value through by reference, so
 * anything that comes back different is something the viewer could not have
 * edited.
 */
function withheldSpanFields({
  storedSpan,
  readableSpan,
}: {
  storedSpan: TraceEditSpanPatch;
  readableSpan: TraceEditSpanPatch | undefined;
}): TraceEditSpanField[] {
  return TRACE_EDIT_SPAN_FIELDS.filter(
    (field) =>
      storedSpan[field] !== undefined && readableSpan?.[field] !== storedSpan[field],
  );
}

function indexBySpanId(spans: TraceEditSpanPatch[]): Map<string, TraceEditSpanPatch> {
  return new Map(spans.map((spanPatch) => [spanPatch.spanId, spanPatch]));
}

function copyFields({
  from,
  onto,
  fields,
}: {
  from: TraceEditSpanPatch;
  onto: TraceEditSpanPatch;
  fields: TraceEditSpanField[];
}): TraceEditSpanPatch {
  const draft = onto as unknown as Record<TraceEditSpanField, unknown>;
  for (const field of fields) draft[field] = from[field];
  return onto;
}

/**
 * The saved span edits with the withheld ones carried over. A span the viewer
 * never saw an edit for cannot have been dropped on purpose, so its withheld
 * fields come back as an entry of their own.
 */
function spansWithWithheldEdits({
  incoming,
  stored,
  readable,
}: {
  incoming: TraceEditSpanPatch[];
  stored: TraceEditSpanPatch[];
  readable: TraceEditSpanPatch[];
}): { value: TraceEditSpanPatch[]; isRestored: boolean } {
  const storedSpans = indexBySpanId(stored);
  const readableSpans = indexBySpanId(readable);
  const savedSpanIds = new Set(incoming.map((spanPatch) => spanPatch.spanId));
  let isRestored = false;

  const withheldFieldsOf = (storedSpan: TraceEditSpanPatch) =>
    withheldSpanFields({
      storedSpan,
      readableSpan: readableSpans.get(storedSpan.spanId),
    });

  const value = incoming.map((incomingSpan) => {
    const storedSpan = storedSpans.get(incomingSpan.spanId);
    const fields = storedSpan ? withheldFieldsOf(storedSpan) : [];
    if (!storedSpan || fields.length === 0) return incomingSpan;
    isRestored = true;
    return copyFields({ from: storedSpan, onto: { ...incomingSpan }, fields });
  });

  for (const storedSpan of stored) {
    if (savedSpanIds.has(storedSpan.spanId)) continue;
    const fields = withheldFieldsOf(storedSpan);
    if (fields.length === 0) continue;
    isRestored = true;
    value.push(
      copyFields({
        from: storedSpan,
        onto: { spanId: storedSpan.spanId },
        fields,
      }),
    );
  }

  return { value, isRestored };
}

/**
 * The saved metadata edits with the withheld keys carried over. Metadata is
 * corrected key by key, so the carry-over is key by key too: a key this viewer
 * never received faithfully comes back as stored, and everything they could
 * read stays theirs to decide, including removing it.
 */
function metadataWithWithheld({
  incoming,
  stored,
  readable,
}: {
  incoming: TraceMetadataEdits | null | undefined;
  stored: TraceMetadataEdits | null | undefined;
  readable: TraceMetadataEdits | null | undefined;
}): { value: TraceMetadataEdits | null | undefined; isRestored: boolean } {
  if (stored === undefined || readable === stored) {
    return { value: incoming, isRestored: false };
  }
  // The whole map was withheld, or the correction cleared it: nothing about it
  // could have been the viewer's decision.
  if (stored === null || readable == null) return { value: stored, isRestored: true };

  const next: TraceMetadataEdits = { ...incoming };
  let isRestored = false;
  for (const [key, value] of Object.entries(stored)) {
    if (readable[key] === value) continue;
    next[key] = value;
    isRestored = true;
  }
  return isRestored ? { value: next, isRestored } : { value: incoming, isRestored };
}

/** The saved trace-level edits with the withheld ones carried over. */
function traceEditsWithWithheld({
  incoming,
  stored,
  readable,
}: {
  incoming: TraceEditOverlayPatch["trace"];
  stored: TraceEditOverlayPatch["trace"];
  readable: TraceEditOverlayPatch["trace"];
}): { value: TraceEditOverlayPatch["trace"]; isRestored: boolean } {
  const value: NonNullable<TraceEditOverlayPatch["trace"]> = { ...incoming };
  let isRestored = false;

  for (const field of ["input", "output"] as const) {
    const storedValue = stored?.[field];
    const isWithheld = storedValue !== undefined && readable?.[field] !== storedValue;
    if (!isWithheld) continue;
    value[field] = storedValue;
    isRestored = true;
  }

  const metadata = metadataWithWithheld({
    incoming: incoming?.metadata,
    stored: stored?.metadata,
    readable: readable?.metadata,
  });
  if (metadata.isRestored) {
    value.metadata = metadata.value;
    isRestored = true;
  }

  const carriesEdit = TRACE_EDIT_TRACE_FIELDS.some((field) => value[field] !== undefined);
  return { value: carriesEdit ? value : void 0, isRestored };
}

/**
 * The correction to store when this viewer saves.
 *
 * A save replaces the whole correction, and the viewer composed theirs on top of
 * the one {@link redactPatchForViewer} handed them, so anything withheld from
 * the read would be dropped by the write, and a reviewer who may not read a
 * field would silently delete someone else's correction to it. Whatever the
 * viewer never received faithfully is therefore carried over from the stored
 * correction: they could not have meant to change it.
 *
 * Everything the viewer could read is theirs to decide, including removing it,
 * and the structural side of the patch (renames, type changes, cleared errors,
 * `deletedSpanIds`) comes from the incoming save unchanged. Removing the whole
 * correction stays a separate, deliberate action.
 */
export function restoreWithheldEdits({
  incoming,
  stored,
  protections,
  isWindowRedacted,
}: {
  incoming: TraceEditOverlayPatch;
  stored: TraceEditOverlayPatch | null | undefined;
  protections: Protections;
  isWindowRedacted?: boolean;
}): TraceEditOverlayPatch {
  if (!stored) return incoming;
  const readable = redactPatchForViewer({
    patch: stored,
    protections,
    isWindowRedacted,
  });
  if (readable === stored) return incoming;

  const spans = spansWithWithheldEdits({
    incoming: incoming.spans,
    stored: stored.spans,
    readable: readable.spans,
  });
  const traceEdits = traceEditsWithWithheld({
    incoming: incoming.trace,
    stored: stored.trace,
    readable: readable.trace,
  });
  if (!spans.isRestored && !traceEdits.isRestored) return incoming;

  const next: TraceEditOverlayPatch = {
    version: incoming.version,
    spans: spans.value,
    deletedSpanIds: incoming.deletedSpanIds,
  };
  if (traceEdits.value) next.trace = traceEdits.value;
  return next;
}
