import { defineSlice } from "@langwatch/browser-host/global-store";

import {
  DEFAULT_PERSPECTIVE_ID,
  type FacetPerspectiveId,
  sectionOrderForPerspective,
} from "./facet-constants.ts";

/**
 * Facet sidebar preferences modeled as a "lens" — section ordering plus explicit
 * open/closed overrides. Single global lens for now; the schema carries id/name so this
 * can later become multiple named lenses backed by a server-side store.
 */
export interface FacetLens {
  id: string;
  name: string;
  /** Facet keys in user-customized display order. Empty = use registry order. */
  sectionOrder: string[];
  /** Per-section open/closed overrides. Missing key = fall back to smart default. */
  sectionOpen: Record<string, boolean>;
}

interface FacetLensState {
  lens: FacetLens;
  /**
   * The active facet perspective. Selecting one stamps its order into the lens above;
   * this id is kept so the manager's switcher can highlight the active choice and
   * survive reloads.
   */
  activePerspectiveId: FacetPerspectiveId;
  setSectionOrder: (order: string[]) => void;
  setSectionOpen: (key: string, open: boolean) => void;
  setAllSectionsOpen: (keys: string[], open: boolean) => void;
  /**
   * Switch perspective: stamp the perspective's section order into the lens (so the
   * sidebar + manager reorder through the existing applyLensOrder machinery) and
   * remember the choice.
   */
  selectPerspective: (id: FacetPerspectiveId) => void;
}

const defaultLens: FacetLens = {
  id: "default",
  name: "Default",
  sectionOrder: [],
  sectionOpen: {},
};

/** The reader's sidebar lens, persisted for them and forgotten at sign-out (§10.2). */
export const useFacetLensStore = defineSlice<FacetLensState>({
  name: "trace:facet-lens",
  create: (set) => ({
    lens: defaultLens,
    activePerspectiveId: DEFAULT_PERSPECTIVE_ID,
    setSectionOrder: (order) => set((s) => ({ lens: { ...s.lens, sectionOrder: order } })),
    setSectionOpen: (key, open) =>
      set((s) => ({ lens: { ...s.lens, sectionOpen: { ...s.lens.sectionOpen, [key]: open } } })),
    setAllSectionsOpen: (keys, open) =>
      set((s) => {
        const sectionOpen = { ...s.lens.sectionOpen };
        for (const k of keys) sectionOpen[k] = open;
        return { lens: { ...s.lens, sectionOpen } };
      }),
    selectPerspective: (id) =>
      set((s) => ({
        lens: { ...s.lens, sectionOrder: sectionOrderForPerspective(id) },
        activePerspectiveId: id,
      })),
  }),
  persist: {
    partialize: ({ lens, activePerspectiveId }) => ({ lens, activePerspectiveId }),
  },
});

/**
 * Apply a user-customized order to a list of all known section keys.
 * Keys present in the lens render in lens order; new/unknown keys append
 * in their natural (registry) order.
 */
export function applyLensOrder(allKeys: readonly string[], lensOrder: readonly string[]): string[] {
  const present = new Set(allKeys);
  const inLens = lensOrder.filter((k) => present.has(k));
  const seen = new Set(inLens);
  const newOnes = allKeys.filter((k) => !seen.has(k));
  return [...inLens, ...newOnes];
}
