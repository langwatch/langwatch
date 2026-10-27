import { useSyncExternalStore } from "react";

/**
 * The modal dialogs open right now. A drawer opened while one is open becomes a stacked modal:
 * it traps focus, which pauses the dialog's trap, and gives focus back to the dialog on close.
 */
let openModals = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** A dialog's content calls this while mounted; the returned function unregisters it. */
export function registerOpenModal(): () => void {
  openModals += 1;
  notify();
  return () => {
    openModals -= 1;
    notify();
  };
}

export function useHasOpenModal(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openModals > 0,
    () => false,
  );
}
