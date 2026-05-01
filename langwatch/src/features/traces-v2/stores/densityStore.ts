import { create } from "zustand";

export type Density = "compact" | "comfortable";

const STORAGE_KEY = "langwatch:traces-v2:density:v1";
const DEFAULT_DENSITY: Density = "compact";

/**
 * Density is a personal preference, not a per-lens or per-URL setting.
 * Lives in its own zustand store backed by `localStorage` so the user's
 * choice persists across sessions and lens switches without leaking into
 * shared/URL state.
 */
function load(): Density {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "compact" || raw === "comfortable") return raw;
  } catch {
    // storage may be disabled
  }
  return DEFAULT_DENSITY;
}

function persist(value: Density): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage may be full / disabled
  }
}

interface DensityState {
  density: Density;
  setDensity: (density: Density) => void;
}

export const useDensityStore = create<DensityState>((set) => ({
  density: load(),
  setDensity: (density) => {
    persist(density);
    set({ density });
  },
}));
