import { useCallback, useMemo } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { expandDeletedSpanIds } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import { useDrawerStore } from "../../../stores/drawerStore";
import {
  selectIsSpanDeleted,
  useTraceEditStore,
} from "../../../stores/traceEditStore";

const NO_DRAFT_NAMES: ReadonlyMap<string, string> = new Map();

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

  // The rename each row should read with while it is unsaved. Only this
  // session's drafts: the stored correction is already in the tree the reader
  // came from.
  const draftNames = useMemo(() => {
    if (!isEditing) return NO_DRAFT_NAMES;
    const names = new Map<string, string>();
    for (const [spanId, draft] of Object.entries(spanDrafts)) {
      if (draft.name !== undefined) names.set(spanId, draft.name);
    }
    return names;
  }, [isEditing, spanDrafts]);

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
