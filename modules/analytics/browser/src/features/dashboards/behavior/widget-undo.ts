/**
 * The toast every widget change on a board ends in, with Undo: one place, so an add, a copy,
 * an edit, a move and a delete all offer it the same way.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { toaster } from "@langwatch/design-system/toaster";

/** Long enough to read the toast and reach Undo; the toast holds while hovered. */
const UNDO_TOAST_MS = 8_000;

/** Shows the toast and returns its id, so a change that fails after all can take it back. */
export function offerUndo({ title, undo }: { title: string; undo: () => void }): string {
  return toaster.create({
    title,
    type: "success",
    duration: UNDO_TOAST_MS,
    action: { label: "Undo", onClick: undo },
  });
}

/** Takes back an Undo offered before the change landed, once that change failed. */
export function withdrawUndo(toastId: string): void {
  toaster.dismiss(toastId);
}
