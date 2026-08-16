import { create } from "zustand";

export type NavigationMode = "legacy" | "product-switcher" | "icon-rail";

export const NAVIGATION_MODES: readonly NavigationMode[] = [
  "legacy",
  "product-switcher",
  "icon-rail",
];

const STORAGE_KEY = "langwatch:navigation-mode:v1";
const DEFAULT_MODE: NavigationMode = "legacy";

/**
 * Which navigation shell this device renders: the current chrome
 * (legacy), the product-switcher top bar, or the icon rail. Purely a
 * per-device preference — localStorage only, never synced to the account —
 * so it lives in its own zustand store the same way the graphics-quality
 * override does. The release_ui_navigation_v2_enabled flag decides whether
 * a non-legacy value takes effect; the preference itself survives the flag
 * turning off.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
function isNavigationMode(value: unknown): value is NavigationMode {
  return NAVIGATION_MODES.includes(value as NavigationMode);
}

export function loadStoredNavigationMode(): NavigationMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isNavigationMode(raw)) return raw;
  } catch {
    // storage may be disabled
  }
  return DEFAULT_MODE;
}

function persist(value: NavigationMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage may be full / disabled
  }
}

interface NavigationModeState {
  storedMode: NavigationMode;
  setStoredMode: (mode: NavigationMode) => void;
}

export const useNavigationModeStore = create<NavigationModeState>((set) => ({
  storedMode: loadStoredNavigationMode(),
  setStoredMode: (mode) => {
    persist(mode);
    set({ storedMode: mode });
  },
}));
