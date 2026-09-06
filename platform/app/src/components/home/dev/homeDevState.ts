import { useEffect, useState } from "react";

/**
 * Development-only previews of the Langy home's states.
 *
 * Most of these states need conditions that are slow or impossible to
 * reproduce on demand: a project with no traces, a turn that stalls, a reader
 * whose account cannot start conversations, the half-second the composer spends
 * in the air. Without a switch, the only way to see them is to break something
 * on purpose, so they go unlooked-at and rot.
 *
 * Gated on `import.meta.env.DEV`, which the production build replaces with a
 * literal `false` — so the branch is dead code before the bundler even looks at
 * it, and there is no runtime path by which any of this reaches a customer.
 *
 * Spec: specs/home/langy-home.feature
 */

export type HomeDevState =
  | "empty"
  | "populated"
  | "read-only"
  | "morph"
  | "docked"
  | "floating"
  | "after-turn"
  | "reduced-motion"
  | "stalled"
  | "chart-strip"
  | "chart-trend"
  | "chart-full";

export interface HomeDevStateOption {
  key: HomeDevState;
  label: string;
}

export const HOME_DEV_STATES: HomeDevStateOption[] = [
  { key: "empty", label: "New project (no data)" },
  { key: "populated", label: "Project with data" },
  { key: "read-only", label: "Read-only access" },
  { key: "morph", label: "Mid-send (held)" },
  { key: "docked", label: "Panel docked" },
  { key: "floating", label: "Panel floating" },
  { key: "after-turn", label: "After the first turn" },
  { key: "reduced-motion", label: "Reduced motion" },
  { key: "stalled", label: "Stalled turn" },
  { key: "chart-strip", label: "Figures: strip (chart on click)" },
  { key: "chart-trend", label: "Figures: strip + trend" },
  { key: "chart-full", label: "Figures: full chart" },
];

/** The overview presentation the Langy home uses when nothing is pinned. */
export const DEFAULT_HOME_CHART_VARIANT = "strip" as const;

/**
 * Which overview presentation a pinned state asks for, if it asks at all.
 *
 * Separate from the state list so the chart variants can be previewed without
 * every other pinned state having to declare an opinion about the figures.
 */
export function chartVariantFor(
  state: HomeDevState | null,
): "full" | "strip" | "trend" {
  switch (state) {
    case "chart-trend":
      return "trend";
    case "chart-full":
      return "full";
    case "chart-strip":
      return "strip";
    default:
      return DEFAULT_HOME_CHART_VARIANT;
  }
}

const STORAGE_KEY = "langwatch:dev:home-state";

export const isHomeDevStateAvailable = () => import.meta.env.DEV;

const isHomeDevState = (value: string): value is HomeDevState =>
  HOME_DEV_STATES.some((state) => state.key === value);

// Same-tab fan-out: `storage` events only fire in OTHER tabs, so writes notify
// the hook instances in this one by hand (the switcher and the block each hold
// one).
const listeners = new Set<() => void>();

function readHomeDevState(): HomeDevState | null {
  if (typeof window === "undefined" || !isHomeDevStateAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && isHomeDevState(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setHomeDevState(state: HomeDevState | null): void {
  if (typeof window === "undefined" || !isHomeDevStateAvailable()) return;
  try {
    if (state === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* Best-effort dev tool. */
  }
  listeners.forEach((notify) => notify());
}

export function useHomeDevState(): HomeDevState | null {
  // Seeded null so the first client render matches the server's markup; the
  // real value arrives in the effect, exactly as the briefing's switcher does.
  const [state, setState] = useState<HomeDevState | null>(null);
  useEffect(() => {
    if (!isHomeDevStateAvailable()) return;
    setState(readHomeDevState());
    const onChange = () => setState(readHomeDevState());
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return state;
}
