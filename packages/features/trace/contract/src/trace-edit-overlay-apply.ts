/**
 * A correction as the canonical trace carries it: the trace read the dataset
 * path and the API hand out. `applyTraceEditOverlayToViews.ts` holds the same
 * corrections against the drawer's own shapes, and both read one patch through
 * the span index built here.
 *
 * The patch is applied as given. What a viewer may read is decided before it
 * reaches here, by `redactPatchForViewer`.
 */
import type { Span, Trace } from "./trace-format.schemas";
import {
  patchHasAnyEdit,
  TRACE_EDIT_SPAN_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
} from "./trace-edit-overlay.contract";

function buildChildrenIndex(
  links: ReadonlyArray<{ id: string; parentId?: string | null }>,
): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  for (const link of links) {
    if (!link.parentId) continue;
    const siblings = childrenByParent.get(link.parentId);
    if (siblings) siblings.push(link.id);
    else childrenByParent.set(link.parentId, [link.id]);
  }
  return childrenByParent;
}

/**
 * Every span the correction removes, including spans that became descendants
 * of a deletion root after the correction was saved. Generic over any
 * id/parent pair so the canonical `Span` tree, the v2 tree nodes and a test
 * fixture all walk through the same code.
 */
export function expandDeletedSpanIds({
  links,
  deletedSpanIds,
}: {
  links: ReadonlyArray<{ id: string; parentId?: string | null }>;
  deletedSpanIds: readonly string[];
}): Set<string> {
  const deleted = new Set(deletedSpanIds);
  if (deleted.size === 0) return deleted;

  const childrenByParent = buildChildrenIndex(links);
  const pending = [...deleted];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (deleted.has(child)) continue;
      deleted.add(child);
      pending.push(child);
    }
  }
  return deleted;
}

/**
 * How many of the spans a trace actually has this correction removes. Ids the
 * correction lists that are not in the trace do not count: the answer is how
 * many rows disappear, not how large the correction is.
 */
export function countRemovedSpans({
  links,
  deletedSpanIds,
}: {
  links: ReadonlyArray<{ id: string; parentId?: string | null }>;
  deletedSpanIds: readonly string[];
}): number {
  const deleted = expandDeletedSpanIds({ links, deletedSpanIds });
  if (deleted.size === 0) return 0;
  let removed = 0;
  for (const link of links) if (deleted.has(link.id)) removed++;
  return removed;
}

/**
 * A patch's span corrections keyed by span id. Exported so a caller applying
 * one correction across a whole page of spans builds the index once instead of
 * once per span.
 */
export function indexSpanPatches(
  patch: TraceEditOverlayPatch,
): Map<string, TraceEditSpanPatch> {
  const bySpanId = new Map<string, TraceEditSpanPatch>();
  for (const spanPatch of patch.spans) bySpanId.set(spanPatch.spanId, spanPatch);
  return bySpanId;
}

/**
 * The canonical `Span` is a union whose members pin `type` to a literal, so the
 * replacements are written through a structural alias instead of fighting the
 * discriminant. Every editable field is named identically on both sides, which
 * is what lets one loop carry all six.
 */
function applySpanPatch({
  span,
  spanPatch,
}: {
  span: Span;
  spanPatch: TraceEditSpanPatch;
}): Span {
  const next = { ...span } as Span;
  const draft = next as unknown as Record<TraceEditSpanField, unknown>;
  let changed = false;

  for (const field of TRACE_EDIT_SPAN_FIELDS) {
    const value = spanPatch[field];
    if (value === undefined) continue;
    draft[field] = value;
    changed = true;
  }

  return changed ? next : span;
}

/**
 * The corrected span list, or null when the correction leaves it exactly as
 * captured.
 */
function correctedSpans({
  spans,
  patch,
}: {
  spans: Span[];
  patch: TraceEditOverlayPatch;
}): Span[] | null {
  const deleted = expandDeletedSpanIds({
    links: spans.map((span) => ({
      id: span.span_id,
      parentId: span.parent_id,
    })),
    deletedSpanIds: patch.deletedSpanIds,
  });
  const patchesBySpanId = indexSpanPatches(patch);

  let changed = false;
  const next: Span[] = [];
  for (const span of spans) {
    if (deleted.has(span.span_id)) {
      changed = true;
      continue;
    }
    const spanPatch = patchesBySpanId.get(span.span_id);
    const corrected = spanPatch ? applySpanPatch({ span, spanPatch }) : span;
    if (corrected !== span) changed = true;
    next.push(corrected);
  }
  return changed ? next : null;
}

/**
 * The trace's metadata with the correction laid over it, or null when the
 * correction says nothing about it.
 *
 * The correction is an overlay on the map rather than a replacement of it: a
 * key it names replaces what the trace recorded, a `null` value removes that
 * key, and a key it does not name stays as captured. That is what lets a
 * correction change one label without restating everything the platform
 * stamped. A `null` in place of the whole map clears the metadata.
 */
function correctedMetadata({
  trace,
  patch,
}: {
  trace: Trace;
  patch: TraceEditOverlayPatch;
}): Trace["metadata"] | null {
  const edits = patch.trace?.metadata;
  if (edits === undefined) return null;
  if (edits === null) return {};

  const next: Record<string, unknown> = { ...trace.metadata };
  for (const [key, value] of Object.entries(edits)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as Trace["metadata"];
}

/**
 * Applies a correction to a canonical trace. Returns the very same trace when
 * the correction leaves every field it carries untouched, so a caller can
 * compare references to learn whether anything was corrected without diffing
 * the payload. An edit whose value equals the captured one still produces a new
 * trace: equality is a property of the values, not of the correction.
 *
 * Timings, metrics, evaluations and events are never touched: a correction
 * says what the trace should have contained, not how long it took or what it
 * cost.
 */
export function applyOverlayToTrace({
  trace,
  patch,
}: {
  trace: Trace;
  patch: TraceEditOverlayPatch | null | undefined;
}): Trace {
  if (!patch || !patchHasAnyEdit(patch)) return trace;

  const spans = correctedSpans({ spans: trace.spans ?? [], patch });
  const input = patch.trace?.input ?? trace.input;
  const output = patch.trace?.output ?? trace.output;
  const metadata = correctedMetadata({ trace, patch });

  const unchanged =
    !spans && !metadata && input === trace.input && output === trace.output;
  if (unchanged) return trace;
  return {
    ...trace,
    spans: spans ?? trace.spans,
    input,
    output,
    metadata: metadata ?? trace.metadata,
  };
}
