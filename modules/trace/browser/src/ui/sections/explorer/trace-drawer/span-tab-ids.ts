import type { SpanTreeNode } from "@langwatch/trace-contract";

/**
 * When more than this many spans are pinned, collapse the tail into a "+N more"
 * dropdown so the tab strip doesn't run away into a horizontal scrollbar swamp.
 */
export const MAX_INLINE_PINNED = 4;
export const INLINE_KEEP_WHEN_OVERFLOW = 3;

/** How many of `pinnedCount` pinned spans keep a tab in the strip. */
export function inlineTabCount({ pinnedCount }: { pinnedCount: number }): number {
  return pinnedCount > MAX_INLINE_PINNED ? INLINE_KEEP_WHEN_OVERFLOW : pinnedCount;
}

/** Resolves each pinned span id to its tree node, dropping any that no longer exist. */
export function resolvePinnedSpans({
  pinnedSpanIds,
  spanTree,
}: {
  pinnedSpanIds: string[];
  spanTree: SpanTreeNode[];
}): SpanTreeNode[] {
  return pinnedSpanIds
    .map((id) => spanTree.find((s) => s.spanId === id))
    .filter((s): s is SpanTreeNode => s != null);
}

/**
 * Tab / menu label for a span: generic tool spans (claude_code.tool ...)
 * append WHICH tool ran so five identical tool tabs stay tellable apart.
 */
export function spanTabLabel(span: {
  name: string | null;
  spanId: string;
  toolName?: string | null;
}): string {
  const base = span.name ?? span.spanId;
  return span.toolName ? `${base} · ${span.toolName}` : base;
}

/**
 * Whether the open span has a tab in the strip: an unpinned one gets a temporary tab, a pinned
 * one only while it is not folded into the "+N more" menu.
 */
export function hasSpanTab({
  spanId,
  pinnedSpans,
}: {
  spanId: string;
  pinnedSpans: SpanTreeNode[];
}): boolean {
  const index = pinnedSpans.findIndex((s) => s.spanId === spanId);
  if (index === -1) return true;
  return index < inlineTabCount({ pinnedCount: pinnedSpans.length });
}

/** The DOM id of a span's tab; `idBase` (from `useId`) keeps two panes' ids apart. */
export function spanTabElementId({ idBase, spanId }: { idBase: string; spanId: string }): string {
  return `${idBase}-span-tab-${encodeURIComponent(spanId)}`;
}

/** The DOM id of the details panel the open tab controls. */
export function spanPanelElementId({ idBase }: { idBase: string }): string {
  return `${idBase}-span-panel`;
}
