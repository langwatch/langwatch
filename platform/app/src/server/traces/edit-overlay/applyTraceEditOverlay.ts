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

/**
 * Which content categories the viewer may not read. A correction never widens
 * what a privacy policy hides: when a category is suppressed the reader keeps
 * the captured value (usually a redaction placeholder) and only the structural
 * edits (renames, type changes, deletions, error clears) apply.
 */
export interface SuppressedContent {
  input?: boolean;
  output?: boolean;
}

/**
 * The content category each editable span field belongs to. `params` rides
 * under `input` because it carries the request payload; `name`, `type` and
 * `error` are structural and are never suppressed.
 */
const SPAN_FIELD_CONTENT_CATEGORY: Record<
  TraceEditSpanField,
  keyof SuppressedContent | null
> = {
  name: null,
  type: null,
  error: null,
  input: "input",
  params: "input",
  output: "output",
};

function isFieldSuppressed({
  field,
  suppressContent,
}: {
  field: TraceEditSpanField;
  suppressContent?: SuppressedContent;
}): boolean {
  const category = SPAN_FIELD_CONTENT_CATEGORY[field];
  return category !== null && suppressContent?.[category] === true;
}

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

function indexSpanPatches(
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
  suppressContent,
}: {
  span: Span;
  spanPatch: TraceEditSpanPatch;
  suppressContent?: SuppressedContent;
}): Span {
  const next = { ...span } as Span;
  const draft = next as unknown as Record<TraceEditSpanField, unknown>;
  let changed = false;

  for (const field of TRACE_EDIT_SPAN_FIELDS) {
    const value = spanPatch[field];
    if (value === undefined) continue;
    if (isFieldSuppressed({ field, suppressContent })) continue;
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
  suppressContent,
}: {
  spans: Span[];
  patch: TraceEditOverlayPatch;
  suppressContent?: SuppressedContent;
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
    const corrected = spanPatch
      ? applySpanPatch({ span, spanPatch, suppressContent })
      : span;
    if (corrected !== span) changed = true;
    next.push(corrected);
  }
  return changed ? next : null;
}

function pickTraceIO<T>({
  captured,
  edited,
  suppressed,
}: {
  captured: T;
  edited: T | undefined;
  suppressed?: boolean;
}): T {
  return edited !== undefined && !suppressed ? edited : captured;
}

/**
 * Applies a correction to a canonical trace. Returns the very same trace when
 * the correction changes nothing about it, so a caller can compare references
 * to learn whether anything was corrected without diffing the payload.
 *
 * Timings, metrics, evaluations and events are never touched: a correction
 * says what the trace should have contained, not how long it took or what it
 * cost.
 */
export function applyOverlayToTrace({
  trace,
  patch,
  suppressContent,
}: {
  trace: Trace;
  patch: TraceEditOverlayPatch | null | undefined;
  suppressContent?: SuppressedContent;
}): Trace {
  if (!patch || !patchHasAnyEdit(patch)) return trace;

  const spans = correctedSpans({
    spans: trace.spans ?? [],
    patch,
    suppressContent,
  });
  const input = pickTraceIO({
    captured: trace.input,
    edited: patch.trace?.input,
    suppressed: suppressContent?.input,
  });
  const output = pickTraceIO({
    captured: trace.output,
    edited: patch.trace?.output,
    suppressed: suppressContent?.output,
  });

  const unchanged = !spans && input === trace.input && output === trace.output;
  if (unchanged) return trace;
  return { ...trace, spans: spans ?? trace.spans, input, output };
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
  suppressContent,
}: {
  detail: SpanDetail;
  patch: TraceEditOverlayPatch | null | undefined;
  suppressContent?: SuppressedContent;
}): SpanDetail {
  if (!patch || !patchHasAnyEdit(patch)) return detail;
  const spanPatch = indexSpanPatches(patch).get(detail.spanId);
  if (!spanPatch) return detail;

  let next = detail;
  for (const field of TRACE_EDIT_SPAN_FIELDS) {
    if (spanPatch[field] === undefined) continue;
    if (isFieldSuppressed({ field, suppressContent })) continue;
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
  suppressContent,
  spans,
}: {
  header: TraceHeader;
  patch: TraceEditOverlayPatch | null | undefined;
  suppressContent?: SuppressedContent;
  spans?: ReadonlyArray<{ spanId: string; parentSpanId?: string | null }>;
}): TraceHeader {
  if (!patch || !patchHasAnyEdit(patch)) return header;

  const next = { ...header };
  let changed = false;
  if (patch.trace?.input !== undefined && !suppressContent?.input) {
    next.input = patch.trace.input.value;
    changed = true;
  }
  if (patch.trace?.output !== undefined && !suppressContent?.output) {
    next.output = patch.trace.output.value;
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
