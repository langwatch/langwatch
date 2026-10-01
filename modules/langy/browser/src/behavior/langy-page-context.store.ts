import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_PAGE_CONTEXT_SLICE,
  type LangyContextChip,
  type LangyPageContextState,
} from "@langwatch/langy-contract";
import { useEffect, useRef } from "react";

export const useLangyPageContextStore = defineSlice<LangyPageContextState>({
  name: LANGY_PAGE_CONTEXT_SLICE,
  create: (set) => ({
    pageContext: [],
    register: (items) => set({ pageContext: items }),
    clear: () => set({ pageContext: [] }),
  }),
});

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
