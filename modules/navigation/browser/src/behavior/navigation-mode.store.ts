import { defineSlice } from "@langwatch/browser-host/global-store";

export type NavigationMode = "product-switcher" | "icon-rail";

export const NAVIGATION_MODES: readonly NavigationMode[] = ["product-switcher", "icon-rail"];

/** The mode a reader sees when they never picked one. */
export const DEFAULT_NAVIGATION_MODE: NavigationMode = "product-switcher";

export const NAVIGATION_MODE_SLICE = "navigation:mode";

/** A stored pick from an older build or a hand edit counts as no pick. */
export function navigationModeOf(value: unknown): NavigationMode {
  return NAVIGATION_MODES.find((mode) => mode === value) ?? DEFAULT_NAVIGATION_MODE;
}

interface NavigationModeState {
  storedMode: NavigationMode | null;
  setStoredMode: (mode: NavigationMode) => void;
}

/** The reader's shell preference, persisted for them and forgotten at sign-out (§10.2). */
export const useNavigationModeStore = defineSlice<NavigationModeState>({
  name: NAVIGATION_MODE_SLICE,
  create: (set) => ({
    storedMode: null,
    setStoredMode: (mode) => set({ storedMode: mode }),
  }),
  persist: { partialize: ({ storedMode }) => ({ storedMode }) },
});
