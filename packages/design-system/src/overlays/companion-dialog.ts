import { useSyncExternalStore } from "react";

/** Marks a panel that stays usable beside a companion dialog, such as an assistant. */
export const DIALOG_COMPANION_ATTR = "data-lw-dialog-companion";

let openCompanionDialogs = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** A companion dialog calls this while open; the returned function unregisters it. */
export function registerCompanionDialog(): () => void {
  openCompanionDialogs += 1;
  notify();
  return () => {
    openCompanionDialogs -= 1;
    notify();
  };
}

/** Whether a companion dialog is open: a companion panel then lifts above its backdrop. */
export function useCompanionDialogOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openCompanionDialogs > 0,
    () => false,
  );
}

/** Whether an event target sits inside a companion panel. */
export function isInDialogCompanion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${DIALOG_COMPANION_ATTR}]`) !== null;
}
