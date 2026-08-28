import { redactHiddenAttributes, type Protections } from "@langwatch/trace-server";
import {
  TRACE_EDIT_SPAN_FIELDS,
  TRACE_EDIT_TRACE_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
  type TraceEditTraceField,
} from "@langwatch/trace-contract";
import { traceAttributeKeyForMetadata } from "./traceMetadataEditableKeys";

/**
 * The content category each editable span field belongs to. `params` rides
 * under `input` because it carries the request payload; `name`, `type` and
 * `error` are structural and belong to no category, so they are never withheld.
 */
const SPAN_FIELD_CONTENT_CATEGORY: Record<TraceEditSpanField, "input" | "output" | null> =
  {
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
  isWindowRedacted,
}: {
  protections: Protections;
  isWindowRedacted?: boolean;
}): IsDeniedByCategory {
  return {
    input: protections.canSeeCapturedInput !== true || isWindowRedacted === true,
    output: protections.canSeeCapturedOutput !== true || isWindowRedacted === true,
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
const TRACE_FIELD_CONTENT_CATEGORY: Record<TraceEditTraceField, "input" | "output"> = {
  input: "input",
  metadata: "input",
  output: "output",
};

/** The trace metadata a correction carries, keyed as the trace stores it. */
export type TraceMetadataEdits = NonNullable<
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
}): { value: TraceEditOverlayPatch["trace"]; isChanged: boolean } {
  if (!traceEdits) return { value: traceEdits, isChanged: false };

  const next: NonNullable<TraceEditOverlayPatch["trace"]> = {};
  const draft = next as unknown as Record<TraceEditTraceField, unknown>;
  let carriesEdit = false;
  let isChanged = false;

  for (const field of TRACE_EDIT_TRACE_FIELDS) {
    const value = readableTraceFieldValue({
      field,
      traceEdits,
      isDeniedByCategory,
      hiddenAttributes,
    });
    isChanged ||= value !== traceEdits[field];
    if (value === undefined) continue;
    draft[field] = value;
    carriesEdit = true;
  }

  if (!isChanged) return { value: traceEdits, isChanged: false };
  return { value: carriesEdit ? next : void 0, isChanged: true };
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
  isWindowRedacted,
}: {
  patch: TraceEditOverlayPatch;
  protections: Protections;
  isWindowRedacted?: boolean;
}): TraceEditOverlayPatch {
  const isDeniedByCategory = deniedCategoriesFor({
    protections,
    isWindowRedacted,
  });
  const hiddenAttributes = isDeniedByCategory.input
    ? void 0
    : protections.hiddenAttributes;

  const traceEdits = redactTraceEdits({
    traceEdits: patch.trace,
    isDeniedByCategory,
    hiddenAttributes,
  });
  let isChanged = traceEdits.isChanged;

  const spans: TraceEditSpanPatch[] = [];
  for (const spanPatch of patch.spans) {
    const redacted = redactSpanPatch({
      spanPatch,
      isDeniedByCategory,
      hiddenAttributes,
    });
    if (redacted !== spanPatch) isChanged = true;
    if (redacted) spans.push(redacted);
  }

  if (!isChanged) return patch;

  const next: TraceEditOverlayPatch = {
    version: patch.version,
    spans,
    deletedSpanIds: patch.deletedSpanIds,
  };
  if (traceEdits.value) next.trace = traceEdits.value;
  return next;
}
