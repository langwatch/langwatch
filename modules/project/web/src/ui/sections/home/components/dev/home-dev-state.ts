import { useUiDeployment } from "@langwatch/ui-host/capabilities";
import { useEffect, useState } from "react";

/**
 * Development-only previews of the Langy home's states that are slow or
 * impossible to reproduce on demand. Gated on the deployment published.
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
 * Separate from the state list so chart variants preview independently.
 */
export function chartVariantFor(state: HomeDevState | null): "full" | "strip" | "trend" {
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

const isHomeDevState = (value: string): value is HomeDevState =>
  HOME_DEV_STATES.some((state) => state.key === value);

// Same-tab fan-out: `storage` events only fire in OTHER tabs, so writes notify
// the hook instances in this one by hand (the switcher and the block each hold
// one).
const listeners = new Set<() => void>();

function readHomeDevState(isDevelopment: boolean): HomeDevState | null {
  if (typeof window === "undefined" || !isDevelopment) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && isHomeDevState(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setHomeDevState({
  state,
  isDevelopment,
}: {
  state: HomeDevState | null;
  isDevelopment: boolean;
}): void {
  if (typeof window === "undefined" || !isDevelopment) return;
  try {
    if (state === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* Best-effort dev tool. */
  }
  listeners.forEach((notify) => notify());
}

export function useHomeDevState(): HomeDevState | null {
  const { isDevelopment } = useUiDeployment();
  // Seeded null so the first client render matches the server's markup; the
  // real value arrives in the effect, exactly as the briefing's switcher does.
  const [state, setState] = useState<HomeDevState | null>(null);
  useEffect(() => {
    if (!isDevelopment) return;
    setState(readHomeDevState(isDevelopment));
    const onChange = () => setState(readHomeDevState(isDevelopment));
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [isDevelopment]);
  return state;
}
