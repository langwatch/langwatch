import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { stringifySpanIO } from "~/server/tracer/spanIOStringify";
import type { Span, Trace } from "~/server/tracer/types";
import {
  patchHasAnyEdit,
  TRACE_EDIT_SPAN_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
} from "./traceEditOverlay.schemas";
import { traceAttributeKeyForMetadata } from "./traceMetadataEditableKeys";

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
  for (const spanPatch of patch.spans)
    bySpanId.set(spanPatch.spanId, spanPatch);
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
 *
 * The patch is applied as given. What a viewer may read is decided before the
 * patch reaches here, by `redactPatchForViewer`.
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

function correctedTreeNode({
  node,
  spanPatch,
}: {
  node: SpanTreeNode;
  spanPatch: TraceEditSpanPatch;
}): SpanTreeNode {
  if (spanPatch.name === undefined && spanPatch.type === undefined) return node;
  const next = { ...node };
  if (spanPatch.name !== undefined) next.name = spanPatch.name ?? "";
  if (spanPatch.type !== undefined) next.type = spanPatch.type;
  return next;
}

/**
 * Applies a correction to the v2 waterfall/flame nodes: deleted spans (and
 * their descendants) drop out, renames and type changes land. Node payloads
 * carry no content, so nothing here is privacy-sensitive.
 */
export function applyOverlayToSpanTreeNodes({
  nodes,
  patch,
}: {
  nodes: SpanTreeNode[];
  patch: TraceEditOverlayPatch | null | undefined;
}): SpanTreeNode[] {
  if (!patch || !patchHasAnyEdit(patch)) return nodes;

  const deleted = expandDeletedSpanIds({
    links: nodes.map((node) => ({
      id: node.spanId,
      parentId: node.parentSpanId,
    })),
    deletedSpanIds: patch.deletedSpanIds,
  });
  const patchesBySpanId = indexSpanPatches(patch);

  let changed = false;
  const nextNodes: SpanTreeNode[] = [];
  for (const node of nodes) {
    if (deleted.has(node.spanId)) {
      changed = true;
      continue;
    }
    const spanPatch = patchesBySpanId.get(node.spanId);
    const corrected = spanPatch ? correctedTreeNode({ node, spanPatch }) : node;
    if (corrected !== node) changed = true;
    nextNodes.push(corrected);
  }

  return changed ? nextNodes : nodes;
}

/**
 * The corrected value of one field as the span detail carries it. Captured
 * values are strings in the drawer, so a corrected canonical value goes through
 * the same stringifier the original went through.
 */
function spanDetailFieldValue({
  field,
  spanPatch,
}: {
  field: TraceEditSpanField;
  spanPatch: TraceEditSpanPatch;
}): Partial<SpanDetail> {
  switch (field) {
    case "name":
      return { name: spanPatch.name ?? "" };
    case "type":
      return { type: spanPatch.type };
    case "error":
      return {
        error: spanPatch.error
          ? {
              message: spanPatch.error.message,
              stacktrace: spanPatch.error.stacktrace,
            }
          : null,
      };
    case "input":
      return { input: stringifySpanIO(spanPatch.input) };
    case "output":
      return { output: stringifySpanIO(spanPatch.output) };
    case "params":
      return { params: spanPatch.params };
  }
}

/** Applies a correction to the v2 span detail. */
export function applyOverlayToSpanDetail({
  detail,
  patch,
  spanPatches,
}: {
  detail: SpanDetail;
  patch: TraceEditOverlayPatch | null | undefined;
  /**
   * The patch's span index when the caller already built one. Without it the
   * index is rebuilt per call, which turns a page of spans into O(spans ×
   * corrected spans).
   */
  spanPatches?: Map<string, TraceEditSpanPatch>;
}): SpanDetail {
  if (!patch || !patchHasAnyEdit(patch)) return detail;
  const spanPatch = (spanPatches ?? indexSpanPatches(patch)).get(detail.spanId);
  if (!spanPatch) return detail;

  let next = detail;
  for (const field of TRACE_EDIT_SPAN_FIELDS) {
    if (spanPatch[field] === undefined) continue;
    next = { ...next, ...spanDetailFieldValue({ field, spanPatch }) };
  }
  return next;
}

/**
 * The span count a correction leaves the header with, or undefined when it
 * removes nothing the trace actually has (including when the caller has no
 * spans to count against).
 */
function correctedSpanCount({
  header,
  patch,
  spans,
}: {
  header: TraceHeader;
  patch: TraceEditOverlayPatch;
  spans?: ReadonlyArray<{ spanId: string; parentSpanId?: string | null }>;
}): number | undefined {
  if (!spans || spans.length === 0) return undefined;
  const removed = countRemovedSpans({
    links: spans.map((span) => ({
      id: span.spanId,
      parentId: span.parentSpanId,
    })),
    deletedSpanIds: patch.deletedSpanIds,
  });
  if (removed === 0) return undefined;
  return Math.max(0, header.spanCount - removed);
}

/**
 * The header's attribute map with the corrected metadata laid over it, or null
 * when the correction says nothing about the metadata.
 *
 * The header keeps the ingested spelling of every key, so a corrected metadata
 * key lands back on the attribute row it was read from. Header attributes are
 * strings, so a corrected structure is rendered as JSON, exactly as the rest of
 * the map already carries structured values.
 */
function correctedHeaderAttributes({
  header,
  patch,
}: {
  header: TraceHeader;
  patch: TraceEditOverlayPatch;
}): TraceHeader["attributes"] | null {
  const edits = patch.trace?.metadata;
  if (edits === undefined) return null;
  if (edits === null) return {};

  const next = { ...header.attributes };
  for (const [key, value] of Object.entries(edits)) {
    const attributeKey = traceAttributeKeyForMetadata(key);
    if (value === null) delete next[attributeKey];
    else next[attributeKey] = headerAttributeText(value);
  }
  return next;
}

function headerAttributeText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

/**
 * The trace metadata keys this correction replaces or removes. Drives the
 * edited markers on the summary's metadata rows.
 */
export function changedTraceMetadataKeys(
  patch: TraceEditOverlayPatch | null | undefined,
): string[] {
  const edits = patch?.trace?.metadata;
  if (edits === undefined || edits === null) return [];
  return Object.keys(edits);
}

/**
 * Applies the trace-level part of a correction to the v2 header. Durations and
 * cost stay as captured: they describe the run, not the corrected content.
 *
 * The span count is the exception, and only when the caller supplies the spans
 * the trace has: a corrected trace does not contain the spans the correction
 * removes, so a header counting eight above a waterfall listing seven reads as
 * a bug rather than as the correction working.
 */
export function applyOverlayToTraceHeader({
  header,
  patch,
  spans,
}: {
  header: TraceHeader;
  patch: TraceEditOverlayPatch | null | undefined;
  spans?: ReadonlyArray<{ spanId: string; parentSpanId?: string | null }>;
}): TraceHeader {
  if (!patch || !patchHasAnyEdit(patch)) return header;

  const next = { ...header };
  let changed = false;
  if (patch.trace?.input !== undefined) {
    next.input = patch.trace.input.value;
    changed = true;
  }
  if (patch.trace?.output !== undefined) {
    next.output = patch.trace.output.value;
    changed = true;
  }
  const attributes = correctedHeaderAttributes({ header, patch });
  if (attributes) {
    next.attributes = attributes;
    changed = true;
  }
  const spanCount = correctedSpanCount({ header, patch, spans });
  if (spanCount !== undefined) {
    next.spanCount = spanCount;
    changed = true;
  }
  return changed ? next : header;
}

/** True when the correction changes or removes this span. Drives the changed
 *  highlight on rows and fields. */
export function overlayTouchesSpan({
  patch,
  spanId,
}: {
  patch: TraceEditOverlayPatch | null | undefined;
  spanId: string;
}): boolean {
  if (!patch) return false;
  if (patch.deletedSpanIds.includes(spanId)) return true;
  return changedSpanFields({ patch, spanId }).length > 0;
}

/** The span fields this correction replaces, in presentation order. */
export function changedSpanFields({
  patch,
  spanId,
}: {
  patch: TraceEditOverlayPatch | null | undefined;
  spanId: string;
}): TraceEditSpanField[] {
  if (!patch) return [];
  const spanPatch = patch.spans.find((entry) => entry.spanId === spanId);
  if (!spanPatch) return [];
  return TRACE_EDIT_SPAN_FIELDS.filter(
    (field) => spanPatch[field] !== undefined,
  );
}
