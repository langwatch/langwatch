/**
 * A correction as the drawer's own shapes carry it: the waterfall nodes, one
 * span's detail, the trace header, and the markers saying which parts of them a
 * correction touched. `applyTraceEditOverlay.ts` holds the same corrections
 * against the canonical trace, and both read one patch through the same span
 * index.
 *
 * The patch is applied as given. What a viewer may read is decided before it
 * reaches here, by `redactPatchForViewer`.
 */
import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { stringifySpanIO } from "~/server/tracer/spanIOStringify";
import {
  countRemovedSpans,
  expandDeletedSpanIds,
  indexSpanPatches,
} from "./applyTraceEditOverlay";
import {
  patchHasAnyEdit,
  TRACE_EDIT_SPAN_FIELDS,
  type TraceEditOverlayPatch,
  type TraceEditSpanField,
  type TraceEditSpanPatch,
} from "./traceEditOverlay.schemas";
import { traceAttributeKeyForMetadata } from "./traceMetadataEditableKeys";

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
