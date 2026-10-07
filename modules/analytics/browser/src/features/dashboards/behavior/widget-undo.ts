/**
 * The toast every widget change on a board ends in, with Undo: one place, so an add, a copy,
 * an edit, a move and a delete all offer it the same way.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { toaster } from "@langwatch/design-system/toaster";

/** Long enough to read the toast and reach Undo; the toast holds while hovered. */
const UNDO_TOAST_MS = 8_000;

export function offerUndo({ title, undo }: { title: string; undo: () => void }): void {
  toaster.create({
    title,
    type: "success",
    duration: UNDO_TOAST_MS,
    action: { label: "Undo", onClick: undo },
  });
}
