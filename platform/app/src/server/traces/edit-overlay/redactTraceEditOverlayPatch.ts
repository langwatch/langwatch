import { redactHiddenAttributes } from "~/server/traces/mappers/redactAttributes";
import type { Protections } from "~/server/traces/protections";
import {
  TRACE_EDIT_SPAN_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
} from "./traceEditOverlay.schemas";

/**
 * The content category each editable span field belongs to. `params` rides
 * under `input` because it carries the request payload; `name`, `type` and
 * `error` are structural and belong to no category, so they are never withheld.
 */
const SPAN_FIELD_CONTENT_CATEGORY: Record<
  TraceEditSpanField,
  "input" | "output" | null
> = {
  name: null,
  type: null,
  error: null,
  input: "input",
  params: "input",
  output: "output",
};

/**
 * Whether this viewer is denied each content category on this trace. Keyed by
 * category so a span field can look its own category up directly.
 */
type IsDeniedByCategory = Record<"input" | "output", boolean>;

function deniedCategoriesFor({
  protections,
  windowRedacted,
}: {
  protections: Protections;
  windowRedacted?: boolean;
}): IsDeniedByCategory {
  return {
    input: protections.canSeeCapturedInput !== true || windowRedacted === true,
    output:
      protections.canSeeCapturedOutput !== true || windowRedacted === true,
  };
}

/**
 * One corrected field as this viewer may read it, or undefined when it is
 * withheld (or was never edited). Restricted attribute rules apply to a
 * corrected `params` exactly as they do to a captured one, so a reviewer cannot
 * widen an attribute's audience by editing the span it sits on.
 */
function readableFieldValue({
  field,
  spanPatch,
  isDeniedByCategory,
  hiddenAttributes,
}: {
  field: TraceEditSpanField;
  spanPatch: TraceEditSpanPatch;
  isDeniedByCategory: IsDeniedByCategory;
  hiddenAttributes: Protections["hiddenAttributes"];
}): unknown {
  const value = spanPatch[field];
  if (value === undefined) return void 0;
  const category = SPAN_FIELD_CONTENT_CATEGORY[field];
  if (category !== null && isDeniedByCategory[category]) return void 0;
  if (field === "params") {
    return redactHiddenAttributes(spanPatch.params, hiddenAttributes);
  }
  return value;
}

/** The span edits this viewer may read, or null when none of them survive. */
function redactSpanPatch({
  spanPatch,
  isDeniedByCategory,
  hiddenAttributes,
}: {
  spanPatch: TraceEditSpanPatch;
  isDeniedByCategory: IsDeniedByCategory;
  hiddenAttributes: Protections["hiddenAttributes"];
}): TraceEditSpanPatch | null {
  const next: TraceEditSpanPatch = { spanId: spanPatch.spanId };
  // Every field name is shared between the patch and its redacted copy, so one
  // assignment carries all of them; the structural alias is what lets this stay
  // a loop instead of six branches.
  const draft = next as unknown as Record<TraceEditSpanField, unknown>;
  let carriesEdit = false;
  let changed = false;

  for (const field of TRACE_EDIT_SPAN_FIELDS) {
    const value = readableFieldValue({
      field,
      spanPatch,
      isDeniedByCategory,
      hiddenAttributes,
    });
    changed ||= value !== spanPatch[field];
    if (value === undefined) continue;
    draft[field] = value;
    carriesEdit = true;
  }

  if (!carriesEdit) return null;
  return changed ? next : spanPatch;
}

/**
 * The trace-level edits this viewer may read, or undefined when none survive.
 */
function redactTraceEdits({
  traceEdits,
  isDeniedByCategory,
}: {
  traceEdits: TraceEditOverlayPatch["trace"];
  isDeniedByCategory: IsDeniedByCategory;
}): { value: TraceEditOverlayPatch["trace"]; changed: boolean } {
  if (!traceEdits) return { value: traceEdits, changed: false };

  const next: NonNullable<TraceEditOverlayPatch["trace"]> = {};
  if (!isDeniedByCategory.input && traceEdits.input !== undefined) {
    next.input = traceEdits.input;
  }
  if (!isDeniedByCategory.output && traceEdits.output !== undefined) {
    next.output = traceEdits.output;
  }

  const present = (edits: NonNullable<TraceEditOverlayPatch["trace"]>) =>
    [edits.input, edits.output].filter((value) => value !== undefined).length;
  const kept = present(next);
  if (kept === present(traceEdits)) {
    return { value: traceEdits, changed: false };
  }
  return { value: kept > 0 ? next : void 0, changed: true };
}

/**
 * The correction as this viewer is allowed to read it.
 *
 * A correction quotes the trace it corrects, so handing one out unfiltered
 * would hand out captured content the privacy policy or the plan's visibility
 * window withholds. Content edits (trace input/output, span input/output/params)
 * drop out when the viewer may not read that category or the trace is beyond
 * the visibility window; corrected `params` that survive still go through the
 * restricted-attribute rules. Structural edits — renames, type changes, cleared
 * errors, deleted spans — always stay: they say what the trace should have
 * looked like without quoting any of it.
 *
 * Pure, and returns the very same patch when the viewer may read all of it, so
 * the common case allocates nothing.
 */
export function redactPatchForViewer({
  patch,
  protections,
  windowRedacted,
}: {
  patch: TraceEditOverlayPatch;
  protections: Protections;
  windowRedacted?: boolean;
}): TraceEditOverlayPatch {
  const isDeniedByCategory = deniedCategoriesFor({
    protections,
    windowRedacted,
  });
  const hiddenAttributes = isDeniedByCategory.input
    ? void 0
    : protections.hiddenAttributes;

  const traceEdits = redactTraceEdits({
    traceEdits: patch.trace,
    isDeniedByCategory,
  });
  let changed = traceEdits.changed;

  const spans: TraceEditSpanPatch[] = [];
  for (const spanPatch of patch.spans) {
    const redacted = redactSpanPatch({
      spanPatch,
      isDeniedByCategory,
      hiddenAttributes,
    });
    if (redacted !== spanPatch) changed = true;
    if (redacted) spans.push(redacted);
  }

  if (!changed) return patch;

  const next: TraceEditOverlayPatch = {
    version: patch.version,
    spans,
    deletedSpanIds: patch.deletedSpanIds,
  };
  if (traceEdits.value) next.trace = traceEdits.value;
  return next;
}

/**
 * The span fields the stored correction holds that this viewer never received
 * faithfully — either dropped outright or handed over with a redaction
 * placeholder in place of the value. Identity comparison is exactly the test:
 * every gate above passes a readable value through by reference, so anything
 * that comes back different is something the viewer could not have edited.
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
      storedSpan[field] !== undefined &&
      readableSpan?.[field] !== storedSpan[field],
  );
}

function indexBySpanId(
  spans: TraceEditSpanPatch[],
): Map<string, TraceEditSpanPatch> {
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
}): { value: TraceEditSpanPatch[]; restored: boolean } {
  const storedSpans = indexBySpanId(stored);
  const readableSpans = indexBySpanId(readable);
  const savedSpanIds = new Set(incoming.map((spanPatch) => spanPatch.spanId));
  let restored = false;

  const withheldFieldsOf = (storedSpan: TraceEditSpanPatch) =>
    withheldSpanFields({
      storedSpan,
      readableSpan: readableSpans.get(storedSpan.spanId),
    });

  const value = incoming.map((incomingSpan) => {
    const storedSpan = storedSpans.get(incomingSpan.spanId);
    const fields = storedSpan ? withheldFieldsOf(storedSpan) : [];
    if (!storedSpan || fields.length === 0) return incomingSpan;
    restored = true;
    return copyFields({ from: storedSpan, onto: { ...incomingSpan }, fields });
  });

  for (const storedSpan of stored) {
    if (savedSpanIds.has(storedSpan.spanId)) continue;
    const fields = withheldFieldsOf(storedSpan);
    if (fields.length === 0) continue;
    restored = true;
    value.push(
      copyFields({
        from: storedSpan,
        onto: { spanId: storedSpan.spanId },
        fields,
      }),
    );
  }

  return { value, restored };
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
}): { value: TraceEditOverlayPatch["trace"]; restored: boolean } {
  const value: NonNullable<TraceEditOverlayPatch["trace"]> = { ...incoming };
  let restored = false;

  for (const category of ["input", "output"] as const) {
    const storedValue = stored?.[category];
    const withheld =
      storedValue !== undefined && readable?.[category] !== storedValue;
    if (!withheld) continue;
    value[category] = storedValue;
    restored = true;
  }

  const carriesEdit = value.input !== undefined || value.output !== undefined;
  return { value: carriesEdit ? value : void 0, restored };
}

/**
 * The correction to store when this viewer saves.
 *
 * A save replaces the whole correction, and the viewer composed theirs on top of
 * the one {@link redactPatchForViewer} handed them — so anything withheld from
 * the read would be dropped by the write, and a reviewer who may not read a
 * field would silently delete someone else's correction to it. Whatever the
 * viewer never received faithfully is therefore carried over from the stored
 * correction: they could not have meant to change it.
 *
 * Everything the viewer could read is theirs to decide, including removing it,
 * and the structural side of the patch — renames, type changes, cleared errors,
 * `deletedSpanIds` — comes from the incoming save unchanged. Removing the whole
 * correction stays a separate, deliberate action.
 */
export function restoreWithheldEdits({
  incoming,
  stored,
  protections,
  windowRedacted,
}: {
  incoming: TraceEditOverlayPatch;
  stored: TraceEditOverlayPatch | null | undefined;
  protections: Protections;
  windowRedacted?: boolean;
}): TraceEditOverlayPatch {
  if (!stored) return incoming;
  const readable = redactPatchForViewer({
    patch: stored,
    protections,
    windowRedacted,
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
  if (!spans.restored && !traceEdits.restored) return incoming;

  const next: TraceEditOverlayPatch = {
    version: incoming.version,
    spans: spans.value,
    deletedSpanIds: incoming.deletedSpanIds,
  };
  if (traceEdits.value) next.trace = traceEdits.value;
  return next;
}
