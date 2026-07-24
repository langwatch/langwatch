import { create } from "zustand";

export type Density = "compact" | "comfortable";

const STORAGE_KEY = "langwatch:traces-v2:density:v1";
// Comfortable is the default for new users — Compact (3px row padding,
// 12px font) reads as "engineering ops dashboard" and was a primary
// driver of the "too dense / too busy" feedback from non-developer
// users. Compact remains a one-click toggle for power users who want
// to see more rows on screen.
//
// Existing users with an explicit `compact` / `comfortable` choice in
// localStorage are unaffected — the load() function below only falls
// back to this default when nothing is persisted yet.
const DEFAULT_DENSITY: Density = "comfortable";

/**
 * Density is a personal preference, not a per-lens or per-URL setting.
 * Lives in its own zustand store backed by `localStorage` so the user's
 * choice persists across sessions and lens switches without leaking into
 * shared/URL state. The trace drawer reads the same value (via
 * `getDrawerDensityTokens`) so the user only ever picks density once and
 * the whole product follows.
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

/**
 * Padding tokens for the trace drawer's accordion section headers
 * (INPUT AND OUTPUT, METADATA, EVALS, EVENTS, EXCEPTIONS …) under the
 * mode-tab strip. These follow the user's shared density preference so
 * the body of the drawer feels coherent with the table density they
 * already picked.
 *
 * The drawer's *title* strip (trace name, metric/source chip row,
 * pinned-context strip, mode tabs) is intentionally NOT density-driven
 * — it carries identity information that's the same size regardless of
 * row preference, and tightening it reads like accidental UI rather
 * than a deliberate density choice.
 *
 * Values are in Chakra space units (1 ≈ 4px).
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
