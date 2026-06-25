/**
 * The reorder reducer for the bulk-upload column-confirm step.
 *
 * Drag-reorder is bound by each column's immutable `sourceHeader` (not array
 * position), so the normalize job can still map file values to the right column
 * after a reorder + rename. Keeping the reducer pure and standalone makes the
 * reorder→payload contract testable without simulating a real DnD gesture
 * (jsdom can't measure layout rects, so a faithful pointer/keyboard drag can't
 * be driven there).
 */
import { arrayMove } from "@dnd-kit/sortable";
import type { DatasetConfirmColumns } from "~/server/datasets/types";

/** Move the dragged column (`active` sourceHeader) to the slot of the column it
 *  was dropped on (`over` sourceHeader). Identity-stable: returns the SAME array
 *  reference when nothing should move (drop on self, or an unknown header), so
 *  the caller can skip a no-op update. */
export function reorderColumnsBySourceHeader(
  columns: DatasetConfirmColumns,
  activeSourceHeader: string,
  overSourceHeader: string,
): DatasetConfirmColumns {
  if (activeSourceHeader === overSourceHeader) return columns;
  const from = columns.findIndex((c) => c.sourceHeader === activeSourceHeader);
  const to = columns.findIndex((c) => c.sourceHeader === overSourceHeader);
  if (from < 0 || to < 0) return columns;
  return arrayMove(columns, from, to);
}
