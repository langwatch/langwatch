import { redactHiddenAttributes } from "~/server/traces/mappers/redactAttributes";
import type { Protections } from "~/server/traces/protections";
import {
  TRACE_EDIT_SPAN_FIELDS,
  TRACE_EDIT_TRACE_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
  type TraceEditTraceField,
} from "./traceEditOverlay.schemas";
import { traceAttributeKeyForMetadata } from "./traceMetadataEditableKeys";

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
 * The content category each trace-level field belongs to. Metadata rides under
 * `input` because it is what the caller sent with the request, and the restrict
 * rules that hide individual attributes apply to it as well.
 */
const TRACE_FIELD_CONTENT_CATEGORY: Record<
  TraceEditTraceField,
  "input" | "output"
> = {
  input: "input",
  metadata: "input",
  output: "output",
};

type TraceMetadataEdits = NonNullable<
  NonNullable<TraceEditOverlayPatch["trace"]>["metadata"]
>;

/**
 * Corrected metadata under the viewer's restrict rules. The rules are written
 * against the attribute paths the trace was ingested with, so the map is put
 * back into that spelling to be matched and read out of it again, keeping one
 * definition of which attributes are hidden.
 */
function redactMetadataEdits({
  metadata,
  hiddenAttributes,
}: {
  metadata: TraceMetadataEdits | null;
  hiddenAttributes: Protections["hiddenAttributes"];
}): TraceMetadataEdits | null {
  if (metadata === null) return metadata;

  const byAttributeKey: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    byAttributeKey[traceAttributeKeyForMetadata(key)] = value;
  }
  const redacted = redactHiddenAttributes(byAttributeKey, hiddenAttributes);
  if (redacted === byAttributeKey) return metadata;

  const next: TraceMetadataEdits = {};
  for (const key of Object.keys(metadata)) {
    next[key] = redacted[traceAttributeKeyForMetadata(key)];
  }
  return next;
}

/**
 * One corrected trace-level field as this viewer may read it, or undefined when
 * it is withheld (or was never edited).
 */
function readableTraceFieldValue({
  field,
  traceEdits,
  isDeniedByCategory,
  hiddenAttributes,
}: {
  field: TraceEditTraceField;
  traceEdits: NonNullable<TraceEditOverlayPatch["trace"]>;
  isDeniedByCategory: IsDeniedByCategory;
  hiddenAttributes: Protections["hiddenAttributes"];
}): unknown {
  const value = traceEdits[field];
  if (value === undefined) return void 0;
  if (isDeniedByCategory[TRACE_FIELD_CONTENT_CATEGORY[field]]) return void 0;
  if (field === "metadata") {
    return redactMetadataEdits({
      metadata: traceEdits.metadata ?? null,
      hiddenAttributes,
    });
  }
  return value;
}

/**
 * The trace-level edits this viewer may read, or undefined when none survive.
 */
function redactTraceEdits({
  traceEdits,
  isDeniedByCategory,
  hiddenAttributes,
}: {
  traceEdits: TraceEditOverlayPatch["trace"];
  isDeniedByCategory: IsDeniedByCategory;
  hiddenAttributes: Protections["hiddenAttributes"];
}): { value: TraceEditOverlayPatch["trace"]; changed: boolean } {
  if (!traceEdits) return { value: traceEdits, changed: false };

  const next: NonNullable<TraceEditOverlayPatch["trace"]> = {};
  const draft = next as unknown as Record<TraceEditTraceField, unknown>;
  let carriesEdit = false;
  let changed = false;

  for (const field of TRACE_EDIT_TRACE_FIELDS) {
    const value = readableTraceFieldValue({
      field,
      traceEdits,
      isDeniedByCategory,
      hiddenAttributes,
    });
    changed ||= value !== traceEdits[field];
    if (value === undefined) continue;
    draft[field] = value;
    carriesEdit = true;
  }

  if (!changed) return { value: traceEdits, changed: false };
  return { value: carriesEdit ? next : void 0, changed: true };
}

/**
 * The correction as this viewer is allowed to read it.
 *
 * A correction quotes the trace it corrects, so handing one out unfiltered
 * would hand out captured content the privacy policy or the plan's visibility
 * window withholds. Content edits (trace input/output, span input/output/params)
 * drop out when the viewer may not read that category or the trace is beyond
 * the visibility window; corrected `params` that survive still go through the
 * restricted-attribute rules. Structural edits (renames, type changes, cleared
 * errors, deleted spans) always stay: they say what the trace should have
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
    hiddenAttributes,
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
 * faithfully: either dropped outright or handed over with a redaction
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
}): { value: TraceMetadataEdits | null | undefined; restored: boolean } {
  if (stored === undefined || readable === stored) {
    return { value: incoming, restored: false };
  }
  // The whole map was withheld, or the correction cleared it: nothing about it
  // could have been the viewer's decision.
  if (stored === null || readable == null)
    return { value: stored, restored: true };

  const next: TraceMetadataEdits = { ...incoming };
  let restored = false;
  for (const [key, value] of Object.entries(stored)) {
    if (readable[key] === value) continue;
    next[key] = value;
    restored = true;
  }
  return restored ? { value: next, restored } : { value: incoming, restored };
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

  for (const field of ["input", "output"] as const) {
    const storedValue = stored?.[field];
    const withheld =
      storedValue !== undefined && readable?.[field] !== storedValue;
    if (!withheld) continue;
    value[field] = storedValue;
    restored = true;
  }

  const metadata = metadataWithWithheld({
    incoming: incoming?.metadata,
    stored: stored?.metadata,
    readable: readable?.metadata,
  });
  if (metadata.restored) {
    value.metadata = metadata.value;
    restored = true;
  }

  const carriesEdit = TRACE_EDIT_TRACE_FIELDS.some(
    (field) => value[field] !== undefined,
  );
  return { value: carriesEdit ? value : void 0, restored };
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
