import { useEffect, useRef } from "react";
import { create } from "zustand";

import type { LangyContextChip } from "./langy.store.ts";

/**
 * The precise context the current page declares for Langy (a dataset with its name), which the
 * route alone cannot express. The panel reads it; any module's page writes it.
 */
interface LangyPageContextState {
  pageContext: LangyContextChip[];
  register: (items: LangyContextChip[]) => void;
  clear: () => void;
}

export const useLangyPageContextStore = create<LangyPageContextState>((set) => ({
  pageContext: [],
  register: (items) => set({ pageContext: items }),
  clear: () => set({ pageContext: [] }),
}));

/**
 * Declares the page's own Langy context: registers on mount, clears on unmount, so the chip
 * follows the page. Harmless where Langy is not mounted, since nothing reads the store there.
 */
export function useRegisterLangyPageContext(items: LangyContextChip[]): void {
  const register = useLangyPageContextStore((state) => state.register);
  const clear = useLangyPageContextStore((state) => state.clear);
  const latest = useRef(items);
  latest.current = items;
  // Keyed on content, so a fresh array literal with the same chips does not re-register.
  const key = JSON.stringify(items);
  useEffect(() => {
    register(latest.current);
    return () => clear();
  }, [key, register, clear]);
}
