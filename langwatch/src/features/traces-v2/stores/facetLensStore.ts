import { create } from "zustand";

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
  /** Group ids in user-customized display order. Empty = use registry order. */
  groupOrder: string[];
  /** Per-section open/closed overrides. Missing key = fall back to smart default. */
  sectionOpen: Record<string, boolean>;
}

interface FacetLensState {
  lens: FacetLens;
  setSectionOrder: (order: string[]) => void;
  setGroupOrder: (order: string[]) => void;
  setSectionOpen: (key: string, open: boolean) => void;
  setAllSectionsOpen: (keys: string[], open: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:facet-lens";

const defaultLens: FacetLens = {
  id: "default",
  name: "Default",
  sectionOrder: [],
  groupOrder: [],
  sectionOpen: {},
};

function loadLens(): FacetLens {
  if (typeof window === "undefined") return defaultLens;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLens;
    const parsed = JSON.parse(raw) as Partial<FacetLens>;
    return {
      id: parsed.id ?? defaultLens.id,
      name: parsed.name ?? defaultLens.name,
      sectionOrder: Array.isArray(parsed.sectionOrder)
        ? parsed.sectionOrder.filter((k): k is string => typeof k === "string")
        : [],
      groupOrder: Array.isArray(parsed.groupOrder)
        ? parsed.groupOrder.filter((k): k is string => typeof k === "string")
        : [],
      sectionOpen:
        parsed.sectionOpen && typeof parsed.sectionOpen === "object"
          ? parsed.sectionOpen
          : {},
    };
  } catch {
    return defaultLens;
  }
}

function persistLens(lens: FacetLens): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lens));
  } catch {
    // storage may be full / disabled
  }
}

export const useFacetLensStore = create<FacetLensState>((set) => ({
  lens: loadLens(),

  setSectionOrder: (order) =>
    set((s) => {
      const next: FacetLens = { ...s.lens, sectionOrder: order };
      persistLens(next);
      return { lens: next };
    }),

  setGroupOrder: (order) =>
    set((s) => {
      const next: FacetLens = { ...s.lens, groupOrder: order };
      persistLens(next);
      return { lens: next };
    }),

  setSectionOpen: (key, open) =>
    set((s) => {
      const next: FacetLens = {
        ...s.lens,
        sectionOpen: { ...s.lens.sectionOpen, [key]: open },
      };
      persistLens(next);
      return { lens: next };
    }),

  setAllSectionsOpen: (keys, open) =>
    set((s) => {
      const sectionOpen = { ...s.lens.sectionOpen };
      for (const k of keys) sectionOpen[k] = open;
      const next: FacetLens = { ...s.lens, sectionOpen };
      persistLens(next);
      return { lens: next };
    }),
}));

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
