/**
 * A drawer a feature opens from its own state rather than the address. It announces itself so
 * whatever rides beside an open drawer (Langy's companion card) treats it as the routed one.
 */

import { useLayoutEffect, useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function shift(delta: number): void {
  openCount = Math.max(0, openCount + delta);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Counts this drawer as open while `open` holds, the way `?drawer.open` counts a routed one. */
export function useInPlaceDrawer({ open }: { open: boolean }): void {
  useLayoutEffect(() => {
    if (!open) return;
    shift(1);
    return () => shift(-1);
  }, [open]);
}

/** Whether any in-place drawer is open now. */
export function useInPlaceDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openCount > 0,
    () => false,
  );
}
