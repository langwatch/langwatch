import { useCallback, useMemo } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { expandDeletedSpanIds } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import { useDrawerStore } from "../../../stores/drawerStore";
import {
  type SpanEditDraft,
  selectIsSpanDeleted,
  useTraceEditStore,
} from "../../../stores/traceEditStore";

const NO_DRAFT_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The name each row should read with while the correction is being written:
 * what an earlier correction renamed it to, with this session's rename on top.
 * The tree itself is the captured one while editing, so leaving the stored
 * rename out would read as this session having lost it.
 */
function correctedNames({
  basePatch,
  spanDrafts,
}: {
  basePatch: TraceEditOverlayPatch | null;
  spanDrafts: Record<string, SpanEditDraft>;
}): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const span of basePatch?.spans ?? []) {
    if (span.name != null) names.set(span.spanId, span.name);
  }
  for (const [spanId, draft] of Object.entries(spanDrafts)) {
    if (draft.name !== undefined) names.set(spanId, draft.name);
  }
  return names;
}

/**
 * The waterfall's half of edit mode: which rows the correction removes, what
 * the reviewer has renamed so far, and how to remove a span or bring one back.
 *
 * Deleting a span deletes its subtree, so every descendant is marked too:
 * a struck-through parent above untouched children would say the correction
 * keeps them, and it does not.
 */
export function useWaterfallEditing(spans: SpanTreeNode[]): {
  isEditing: boolean;
  deletedSpanIds: Set<string>;
  draftNames: ReadonlyMap<string, string>;
  toggleSpanDeleted: (spanId: string) => void;
} {
  const isEditing = useDrawerStore((s) => s.editing);
  const clearSpan = useDrawerStore((s) => s.clearSpan);
  const unpinSpan = useDrawerStore((s) => s.unpinSpan);
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const sessionDeleted = useTraceEditStore((s) => s.deletedSpanIds);
  const restoredSpanIds = useTraceEditStore((s) => s.restoredSpanIds);
  const spanDrafts = useTraceEditStore((s) => s.spanDrafts);

  const deletedSpanIds = useMemo(() => {
    if (!isEditing) return new Set<string>();
    const roots = spans
      .map((span) => span.spanId)
      .filter((spanId) =>
        selectIsSpanDeleted(
          { basePatch, deletedSpanIds: sessionDeleted, restoredSpanIds },
          spanId,
        ),
      );
    return expandDeletedSpanIds({
      links: spans.map((span) => ({
        id: span.spanId,
        parentId: span.parentSpanId,
      })),
      deletedSpanIds: roots,
    });
  }, [isEditing, spans, basePatch, sessionDeleted, restoredSpanIds]);

  const draftNames = useMemo(
    () =>
      isEditing ? correctedNames({ basePatch, spanDrafts }) : NO_DRAFT_NAMES,
    [isEditing, basePatch, spanDrafts],
  );

  const toggleSpanDeleted = useCallback(
    (spanId: string) => {
      const store = useTraceEditStore.getState();
      const isDeleted = selectIsSpanDeleted(store, spanId);
      if (isDeleted) {
        store.restoreSpan(spanId);
        return;
      }
      store.deleteSpan(spanId);
      // A span the correction removes can no longer be inspected, so it stops
      // being the open detail and stops holding a tab.
      const drawer = useDrawerStore.getState();
      if (drawer.selectedSpanId === spanId) clearSpan();
      if (drawer.pinnedSpanIds.includes(spanId)) unpinSpan(spanId);
    },
    [clearSpan, unpinSpan],
  );

  return { isEditing, deletedSpanIds, draftNames, toggleSpanDeleted };
}
