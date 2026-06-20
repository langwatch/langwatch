import { create } from "zustand";

export type NumericMode = "range" | "discrete";

/**
 * Per-project, per-facet override for how a numeric facet is presented —
 * "range" (the min/max slider) or "discrete" (tick the distinct integer
 * values). Only meaningful for discrete-eligible facets; the sidebar resolves
 * the effective mode as `override ?? registry-default` (eligible facets
 * default to "discrete"). Modeled on `facetVisibilityStore`: keyed per project
 * so one project's choice doesn't leak into another, persisted to
 * localStorage, hydrated on mount.
 */
export interface NumericModeState {
  byProject: Record<string, Record<string, NumericMode>>;
  hydrateFromStorage: (projectId: string) => void;
  /** Override a facet's presentation. */
  setMode: (params: {
    projectId: string;
    field: string;
    mode: NumericMode;
  }) => void;
  /** Drop the override for `field` — reverts to the registry default. */
  resetField: (params: { projectId: string; field: string }) => void;
}

const STORAGE_PREFIX = "langwatch:traces-v2:numeric-mode:v1:";

interface StoredShape {
  version: 1;
  modes: Record<string, NumericMode>;
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function isMode(x: unknown): x is NumericMode {
  return x === "range" || x === "discrete";
}

function readFromStorage(projectId: string): Record<string, NumericMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredShape;
    if (
      parsed.version !== 1 ||
      typeof parsed.modes !== "object" ||
      parsed.modes === null
    ) {
      return {};
    }
    const out: Record<string, NumericMode> = {};
    for (const [k, v] of Object.entries(parsed.modes)) {
      if (isMode(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeToStorage(params: {
  projectId: string;
  modes: Record<string, NumericMode>;
}): void {
  const { projectId, modes } = params;
  if (typeof window === "undefined") return;
  try {
    const payload: StoredShape = { version: 1, modes };
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
  } catch {
    // storage may be full / disabled — sidebar falls back to defaults.
  }
}

/** Stable empty reference for the selector — keeps Zustand's ref bailout. */
const STABLE_EMPTY: Record<string, NumericMode> = {};

export const useNumericModeStore = create<NumericModeState>((set, get) => ({
  byProject: {},

  hydrateFromStorage: (projectId) => {
    const stored = readFromStorage(projectId);
    set((s) => ({ byProject: { ...s.byProject, [projectId]: stored } }));
  },

  setMode: ({ projectId, field, mode }) => {
    const current = get().byProject[projectId] ?? readFromStorage(projectId);
    const next = { ...current, [field]: mode };
    writeToStorage({ projectId, modes: next });
    set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
  },

  resetField: ({ projectId, field }) => {
    const current = get().byProject[projectId] ?? readFromStorage(projectId);
    const next = { ...current };
    delete next[field];
    writeToStorage({ projectId, modes: next });
    set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
  },
}));

/**
 * Project's mode overrides as a stable projection — same reference until
 * `byProject[projectId]` changes, so subscribers don't churn. Hydration is a
 * separate side-effect the caller schedules in a mount effect.
 */
export function selectNumericModesFor(params: {
  state: NumericModeState;
  projectId: string | null | undefined;
}): Record<string, NumericMode> {
  const { state, projectId } = params;
  if (!projectId) return STABLE_EMPTY;
  return state.byProject[projectId] ?? STABLE_EMPTY;
}
