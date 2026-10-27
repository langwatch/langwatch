import { createContext, useSyncExternalStore } from "react";

export const DrawerOffsetContext = createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

let endInset = 0;
const endInsetListeners = new Set<() => void>();

/** The shell sets the room a docked side panel keeps on the right edge; every drawer yields it. */
export function setDrawerEndInset(px: number): void {
  if (px === endInset) return;
  endInset = px;
  for (const listener of endInsetListeners) listener();
}

export function useDrawerEndInset(): number {
  return useSyncExternalStore(
    (listener) => {
      endInsetListeners.add(listener);
      return () => endInsetListeners.delete(listener);
    },
    () => endInset,
    () => 0,
  );
}
