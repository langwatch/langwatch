import { create } from "zustand";
import {
  DEFAULT_PERSPECTIVE_ID,
  type FacetPerspectiveId,
  isFacetPerspectiveId,
  sectionOrderForPerspective,
} from "../components/FilterSidebar/constants";

/**
 * Facet sidebar preferences modeled as a "lens" — section ordering plus
 * explicit open/closed overrides. Single global lens for now; the schema
 * carries id/name so this can later become multiple named lenses backed
 * by a server-side store. The exposed actions match the surface a future
 * API client would expose, so the persistence swap stays local to this file.
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
   * The active facet perspective. Selecting one stamps its order into the
   * lens above; this id is kept so the manager's switcher can highlight the
   * active choice and survive reloads. A subsequent drag-reorder edits the
   * lens order but leaves this id pointing at the perspective the user is
   * "in" (the same draft-on-a-preset model the toolbar lenses use).
   */
  activePerspectiveId: FacetPerspectiveId;
  setSectionOrder: (order: string[]) => void;
  setSectionOpen: (key: string, open: boolean) => void;
  setAllSectionsOpen: (keys: string[], open: boolean) => void;
  /**
   * Switch perspective: stamp the perspective's section order into the lens
   * (so the sidebar + manager reorder through the existing applyLensOrder
   * machinery) and remember the choice. Re-selecting a perspective restores
   * its built-in order even after a custom drag-reorder.
   */
  selectPerspective: (id: FacetPerspectiveId) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:facet-lens";

const defaultLens: FacetLens = {
  id: "default",
  name: "Default",
  sectionOrder: [],
  sectionOpen: {},
};

interface PersistedState {
  lens: FacetLens;
  activePerspectiveId: FacetPerspectiveId;
}

function loadState(): PersistedState {
  if (typeof window === "undefined") {
    return { lens: defaultLens, activePerspectiveId: DEFAULT_PERSPECTIVE_ID };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { lens: defaultLens, activePerspectiveId: DEFAULT_PERSPECTIVE_ID };
    }
    // Backward compatible: the blob is the flat FacetLens shape, with
    // `activePerspectiveId` added as a sibling field. Pre-perspective blobs
    // simply lack it. Any stale `groupOrder` from an older build is ignored.
    const parsed = JSON.parse(raw) as Partial<FacetLens> & {
      activePerspectiveId?: unknown;
    };
    const lens: FacetLens = {
      id: parsed.id ?? defaultLens.id,
      name: parsed.name ?? defaultLens.name,
      sectionOrder: Array.isArray(parsed.sectionOrder)
        ? parsed.sectionOrder.filter((k): k is string => typeof k === "string")
        : [],
      sectionOpen:
        parsed.sectionOpen && typeof parsed.sectionOpen === "object"
          ? parsed.sectionOpen
          : {},
    };
    return {
      lens,
      activePerspectiveId: isFacetPerspectiveId(parsed.activePerspectiveId)
        ? parsed.activePerspectiveId
        : DEFAULT_PERSPECTIVE_ID,
    };
  } catch {
    return { lens: defaultLens, activePerspectiveId: DEFAULT_PERSPECTIVE_ID };
  }
}

function persistState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state.lens,
        activePerspectiveId: state.activePerspectiveId,
      }),
    );
  } catch {
    // storage may be full / disabled
  }
}

export const useFacetLensStore = create<FacetLensState>((set) => {
  const initial = loadState();
  return {
    lens: initial.lens,
    activePerspectiveId: initial.activePerspectiveId,

    setSectionOrder: (order) =>
      set((s) => {
        const lens: FacetLens = { ...s.lens, sectionOrder: order };
        persistState({ lens, activePerspectiveId: s.activePerspectiveId });
        return { lens };
      }),

    setSectionOpen: (key, open) =>
      set((s) => {
        const lens: FacetLens = {
          ...s.lens,
          sectionOpen: { ...s.lens.sectionOpen, [key]: open },
        };
        persistState({ lens, activePerspectiveId: s.activePerspectiveId });
        return { lens };
      }),

    setAllSectionsOpen: (keys, open) =>
      set((s) => {
        const sectionOpen = { ...s.lens.sectionOpen };
        for (const k of keys) sectionOpen[k] = open;
        const lens: FacetLens = { ...s.lens, sectionOpen };
        persistState({ lens, activePerspectiveId: s.activePerspectiveId });
        return { lens };
      }),

    selectPerspective: (id) =>
      set((s) => {
        const lens: FacetLens = {
          ...s.lens,
          sectionOrder: sectionOrderForPerspective(id),
        };
        persistState({ lens, activePerspectiveId: id });
        return { lens, activePerspectiveId: id };
      }),
  };
});

/**
 * Apply a user-customized order to a list of all known section keys.
 * Keys present in the lens render in lens order; new/unknown keys append
 * in their natural (registry) order.
 */
export function applyLensOrder(
  allKeys: readonly string[],
  lensOrder: readonly string[],
): string[] {
  const present = new Set(allKeys);
  const inLens = lensOrder.filter((k) => present.has(k));
  const seen = new Set(inLens);
  const newOnes = allKeys.filter((k) => !seen.has(k));
  return [...inLens, ...newOnes];
}
