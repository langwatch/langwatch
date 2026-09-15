import { create } from "zustand";

export type NavigationMode = "product-switcher" | "icon-rail";

export const NAVIGATION_MODES: readonly NavigationMode[] = ["product-switcher", "icon-rail"];

/** The mode a device renders when the reader never picked one. */
export const DEFAULT_NAVIGATION_MODE: NavigationMode = "product-switcher";

export const NAVIGATION_MODE_STORAGE_KEY = "langwatch:navigation-mode:v1";

/** Per-device shell preference (null until set); server/client render must match for hydration */
function isNavigationMode(value: unknown): value is NavigationMode {
  return NAVIGATION_MODES.includes(value as NavigationMode);
}

/** The reader's own pick, or null when they never made one. */
export function loadStoredNavigationMode(): NavigationMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(NAVIGATION_MODE_STORAGE_KEY);
    if (isNavigationMode(raw)) return raw;
  } catch {
    // storage may be disabled
  }
  return null;
}

function persist({ key, value }: { key: string; value: string }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage may be full / disabled
  }
}

interface NavigationModeState {
  storedMode: NavigationMode | null;
  /** Apply the persisted pick after mount. Writes to state only, no persist. */
  hydrateStoredMode: (mode: NavigationMode | null) => void;
  setStoredMode: (mode: NavigationMode) => void;
}

export const useNavigationModeStore = create<NavigationModeState>((set) => ({
  storedMode: null,
  hydrateStoredMode: (mode) => set({ storedMode: mode }),
  setStoredMode: (mode) => {
    persist({ key: NAVIGATION_MODE_STORAGE_KEY, value: mode });
    set({ storedMode: mode });
  },
}));
