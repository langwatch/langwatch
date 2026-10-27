import { readSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_PAGE_CONTEXT,
  LANGY_PAGE_CONTEXT_SLICE,
  type LangyContextChip,
  type LangyPageContextState,
} from "@langwatch/langy-contract";
import { useEffect, useRef } from "react";

/** The page context Langy reads, held in the global UI store (`langy:page-context`). */
export const useLangyPageContextStore = readSlice<LangyPageContextState>({
  name: LANGY_PAGE_CONTEXT_SLICE,
  absent: LANGY_ABSENT_PAGE_CONTEXT,
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
