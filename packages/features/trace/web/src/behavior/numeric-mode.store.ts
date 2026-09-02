import { create } from "zustand";
import { z } from "zod";

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
  setMode: (params: { projectId: string; field: string; mode: NumericMode }) => void;
}

const STORAGE_PREFIX = "langwatch:traces-v2:numeric-mode:v1:";

const storedShapeSchema = z.object({
  version: z.literal(1),
  modes: z.record(z.string(), z.unknown()),
});
const modeSchema = z.enum(["range", "discrete"]);

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function readFromStorage(projectId: string): Record<string, NumericMode> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) {
      return {};
    }
    const parsed = storedShapeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return {};
    }
    const modes: Record<string, NumericMode> = {};
    for (const [field, value] of Object.entries(parsed.data.modes)) {
      const mode = modeSchema.safeParse(value);
      if (mode.success) {
        modes[field] = mode.data;
      }
    }
    return modes;
  } catch {
    return {};
  }
}

function writeToStorage(params: { projectId: string; modes: Record<string, NumericMode> }): void {
  const { projectId, modes } = params;
  if (typeof window === "undefined") {
    return;
  }
  try {
    const payload = { version: 1 as const, modes };
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
  if (!projectId) {
    return STABLE_EMPTY;
  }
  return state.byProject[projectId] ?? STABLE_EMPTY;
}
