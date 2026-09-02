import { create } from "zustand";

export type NavigationMode = "legacy" | "product-switcher" | "icon-rail";

export const NAVIGATION_MODES: readonly NavigationMode[] = [
  "legacy",
  "product-switcher",
  "icon-rail",
];

/**
 * The mode a device renders when the reader never picked one and the
 * release_ui_navigation_v2_enabled flag is on. With the flag off the
 * mode is always legacy, whatever this says.
 */
export const DEFAULT_NAVIGATION_MODE: NavigationMode = "product-switcher";

const STORAGE_KEY = "langwatch:navigation-mode:v1";
const FLAG_STORAGE_KEY = "langwatch:navigation-mode-flag:v1";

/**
 * Which navigation shell this device renders: the current chrome
 * (legacy), the product-switcher top bar, or the icon rail. Purely a
 * per-device preference (localStorage only, never synced to the account),
 * so it lives in its own zustand store the same way the graphics-quality
 * override does. The release_ui_navigation_v2_enabled flag decides whether
 * a non-legacy value takes effect; the preference itself survives the flag
 * turning off.
 *
 * The store keeps two values. `storedMode` is the reader's own pick and
 * is null until they make one, so "never picked" and "picked the old
 * navigation" stay different answers. `isLastKnownFlagEnabled` is the
 * last answer the flag gave on this device, which lets a device with no
 * pick paint its mode on the first frame instead of waiting for the flag
 * query. It is a device-wide hint, so a reader who belongs to one
 * organization with the flag on and one with it off may paint the
 * previous organization's answer for the one frame before the query
 * lands. Subscribe to the store to read it, never read it once: the
 * query answer lands in the store, and a device the flag turns off for
 * must follow it.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
function isNavigationMode(value: unknown): value is NavigationMode {
  return NAVIGATION_MODES.includes(value as NavigationMode);
}

/** The reader's own pick, or null when they never made one. */
export function loadStoredNavigationMode(): NavigationMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isNavigationMode(raw)) return raw;
  } catch {
    // storage may be disabled
  }
  return null;
}

/** The last flag answer this device saw, or null before the first one. */
export function loadLastKnownNavigationFlag(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FLAG_STORAGE_KEY);
    if (raw === "on") return true;
    if (raw === "off") return false;
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
  isLastKnownFlagEnabled: boolean | null;
  setStoredMode: (mode: NavigationMode) => void;
  rememberFlag: (isEnabled: boolean) => void;
}

export const useNavigationModeStore = create<NavigationModeState>((set, get) => ({
  storedMode: loadStoredNavigationMode(),
  isLastKnownFlagEnabled: loadLastKnownNavigationFlag(),
  setStoredMode: (mode) => {
    persist({ key: STORAGE_KEY, value: mode });
    set({ storedMode: mode });
  },
  rememberFlag: (isEnabled) => {
    if (get().isLastKnownFlagEnabled === isEnabled) return;
    persist({ key: FLAG_STORAGE_KEY, value: isEnabled ? "on" : "off" });
    set({ isLastKnownFlagEnabled: isEnabled });
  },
}));
