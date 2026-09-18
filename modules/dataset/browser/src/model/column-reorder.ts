/** Drag-reorder by sourceHeader (not position) so normalize maps correctly.
 * Pure reducer, testable without DnD.
 */
import { arrayMove } from "@dnd-kit/sortable";
import type { DatasetConfirmColumns } from "@langwatch/dataset-contract";

/** Move the dragged column (`active` sourceHeader) to the slot of the column it
 *  was dropped on (`over` sourceHeader). Identity-stable: returns the SAME array
 *  reference when nothing should move (drop on self, or an unknown header), so
 *  the caller can skip a no-op update. */
export function reorderColumnsBySourceHeader({
  columns,
  activeSourceHeader,
  overSourceHeader,
}: {
  columns: DatasetConfirmColumns;
  activeSourceHeader: string;
  overSourceHeader: string;
}): DatasetConfirmColumns {
  if (activeSourceHeader === overSourceHeader) return columns;
  const from = columns.findIndex((c) => c.sourceHeader === activeSourceHeader);
  const to = columns.findIndex((c) => c.sourceHeader === overSourceHeader);
  if (from < 0 || to < 0) return columns;
  return arrayMove(columns, from, to);
}
