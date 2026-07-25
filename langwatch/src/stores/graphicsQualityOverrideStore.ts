import { create } from "zustand";

export type GraphicsQualityOverride = "auto" | "on" | "off";

const STORAGE_KEY = "langwatch:graphics-quality-override:v1";
const DEFAULT_OVERRIDE: GraphicsQualityOverride = "auto";

/**
 * Manual escape hatch on top of GraphicsQualityProvider's automatic FPS
 * probe. Purely a per-device preference — localStorage only, never synced
 * to the account/backend — so it lives in its own zustand store the same
 * way traces-v2's density preference does (see densityStore.ts).
 */
function load(): GraphicsQualityOverride {
  if (typeof window === "undefined") return DEFAULT_OVERRIDE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "auto" || raw === "on" || raw === "off") return raw;
  } catch {
    // storage may be disabled
  }
  return DEFAULT_OVERRIDE;
}

function persist(value: GraphicsQualityOverride): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage may be full / disabled
  }
}

interface GraphicsQualityOverrideState {
  override: GraphicsQualityOverride;
  setOverride: (override: GraphicsQualityOverride) => void;
}

export const useGraphicsQualityOverrideStore =
  create<GraphicsQualityOverrideState>((set) => ({
    override: load(),
    setOverride: (override) => {
      persist(override);
      set({ override });
    },
  }));
