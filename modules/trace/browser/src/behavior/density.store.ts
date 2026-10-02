import { defineSlice } from "@langwatch/browser-host/global-store";

export type Density = "compact" | "comfortable";

// Comfortable is the default for new users — Compact (3px row padding, 12px font) reads
// as "engineering ops dashboard" and was a primary driver of the "too dense / too busy"
// feedback from non-developer users.
export const DEFAULT_DENSITY: Density = "comfortable";

interface DensityState {
  density: Density;
  setDensity: (density: Density) => void;
}

/** A personal preference, persisted for the reader rather than per lens or URL (§10.2). */
export const useDensityStore = defineSlice<DensityState>({
  name: "trace:density",
  create: (set) => ({
    density: DEFAULT_DENSITY,
    setDensity: (density) => set({ density }),
  }),
  persist: { partialize: ({ density }) => ({ density }) },
});

/**
 * Padding tokens for the trace drawer's accordion section headers (INPUT AND OUTPUT,
 * METADATA, EVALS, EVENTS, EXCEPTIONS …) under the mode-tab strip.
 */
export interface DrawerDensityTokens {
  /** Vertical padding on accordion section header (the trigger row). */
  sectionTriggerY: number;
  /** Vertical padding around accordion section body content. */
  sectionContentY: number;
}

export function getDrawerDensityTokens(density: Density): DrawerDensityTokens {
  if (density === "compact") {
    return { sectionTriggerY: 1.5, sectionContentY: 1.5 };
  }
  return { sectionTriggerY: 2.5, sectionContentY: 2.5 };
}
