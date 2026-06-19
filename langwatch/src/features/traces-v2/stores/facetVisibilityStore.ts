import { create } from "zustand";

/**
 * Per-project, per-user overrides on top of the density-driven default
 * facet visibility. Two opt-in sets:
 *
 *   - `explicitlyShown` — facet keys the user added back even though
 *     the active density (Comfortable) would hide them by default.
 *   - `explicitlyHidden` — facet keys the user dismissed even though
 *     the active density (Compact / Comfortable) would show them.
 *
 * Effective visibility = (density-default ∪ explicitlyShown ∪
 * active-in-AST) \ explicitlyHidden \ has-zero-data. The resolver lives
 * in `useFilterSidebarData`; this store just owns the persistence +
 * mutation surface so the sidebar can `addFacet` / `hideFacet` without
 * caring about how the resolver consumes them.
 *
 * State is keyed per project — copied from `pinnedAttributesStore`'s
 * approach so a user with multiple projects doesn't carry their
 * customer-A facet shape into customer-B.
 */
export interface FacetVisibilityState {
  byProject: Record<
    string,
    {
      explicitlyShown: string[];
      explicitlyHidden: string[];
    }
  >;
  hydrateFromStorage: (projectId: string) => void;
  /** Add a facet key that density would hide. */
  showFacet: (projectId: string, key: string) => void;
  /** Hide a facet key that density would show. */
  hideFacet: (projectId: string, key: string) => void;
  /** Drop both overrides for `key` — reverts to density default. */
  resetFacet: (projectId: string, key: string) => void;
  /** Drop ALL overrides for the project — reverts the whole sidebar. */
  resetAll: (projectId: string) => void;
}

const STORAGE_PREFIX = "langwatch:traces-v2:facet-visibility:v1:";

interface StoredShape {
  version: 1;
  explicitlyShown: string[];
  explicitlyHidden: string[];
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function readFromStorage(projectId: string): {
  explicitlyShown: string[];
  explicitlyHidden: string[];
} {
  const fallback = { explicitlyShown: [], explicitlyHidden: [] };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredShape;
    if (parsed.version !== 1) return fallback;
    return {
      explicitlyShown: Array.isArray(parsed.explicitlyShown)
        ? parsed.explicitlyShown.filter((s): s is string => typeof s === "string")
        : [],
      explicitlyHidden: Array.isArray(parsed.explicitlyHidden)
        ? parsed.explicitlyHidden.filter(
            (s): s is string => typeof s === "string",
          )
        : [],
    };
  } catch {
    return fallback;
  }
}

function writeToStorage(
  projectId: string,
  prefs: { explicitlyShown: string[]; explicitlyHidden: string[] },
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredShape = {
      version: 1,
      explicitlyShown: prefs.explicitlyShown,
      explicitlyHidden: prefs.explicitlyHidden,
    };
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
  } catch {
    // Storage may be full / disabled; sidebar gracefully falls back to
    // the density default.
  }
}

function emptyPrefs() {
  return { explicitlyShown: [], explicitlyHidden: [] };
}

/**
 * Stable empty reference for the selector — Zustand bails out of
 * re-renders when the selected slice is referentially equal, so we
 * must hand the same object back on every unhydrated read. A fresh
 * `emptyPrefs()` would force a re-render on each subscription tick.
 */
const STABLE_EMPTY_PREFS: {
  explicitlyShown: string[];
  explicitlyHidden: string[];
} = { explicitlyShown: [], explicitlyHidden: [] };

export const useFacetVisibilityStore = create<FacetVisibilityState>(
  (set, get) => ({
    byProject: {},

    hydrateFromStorage: (projectId) => {
      const stored = readFromStorage(projectId);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: stored } }));
    },

    showFacet: (projectId, key) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      // Show wins over hide — if it was hidden, remove from hidden first.
      const next = {
        explicitlyShown: current.explicitlyShown.includes(key)
          ? current.explicitlyShown
          : [...current.explicitlyShown, key],
        explicitlyHidden: current.explicitlyHidden.filter((k) => k !== key),
      };
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    hideFacet: (projectId, key) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      // Hide wins over show — symmetric to showFacet.
      const next = {
        explicitlyShown: current.explicitlyShown.filter((k) => k !== key),
        explicitlyHidden: current.explicitlyHidden.includes(key)
          ? current.explicitlyHidden
          : [...current.explicitlyHidden, key],
      };
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    resetFacet: (projectId, key) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      const next = {
        explicitlyShown: current.explicitlyShown.filter((k) => k !== key),
        explicitlyHidden: current.explicitlyHidden.filter((k) => k !== key),
      };
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    resetAll: (projectId) => {
      const next = emptyPrefs();
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },
  }),
);

/**
 * Convenience selector — returns the prefs for a project. A pure
 * projection on store state, so it keeps Zustand's ref-equality bailout
 * intact: consumers see the same object reference on every read until
 * `byProject[projectId]` actually changes. Hydration is a side-effect
 * the caller schedules separately (`hydrateFromStorage` in a mount
 * effect); pre-hydrate reads land on `STABLE_EMPTY_PREFS`.
 */
export function selectVisibilityFor(
  state: FacetVisibilityState,
  projectId: string | null | undefined,
): { explicitlyShown: string[]; explicitlyHidden: string[] } {
  if (!projectId) return STABLE_EMPTY_PREFS;
  return state.byProject[projectId] ?? STABLE_EMPTY_PREFS;
}
