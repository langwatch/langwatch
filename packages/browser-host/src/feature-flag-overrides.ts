/**
 * This browser's own feature-flag answers, set from `?ff_<flag>=on|off|clear` and kept in
 * localStorage. A flag read that finds one answers it without asking the server.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { FRONTEND_FEATURE_FLAGS, type FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { useEffect, useState } from "react";

const STORAGE_KEY = "langwatch:dev:feature-flag-overrides";

export type FeatureFlagOverrides = Partial<Record<FrontendFeatureFlag, boolean>>;

// `storage` events only reach other tabs, so this tab's own writes fan out here.
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/** Every flag this browser answered, ignoring unknown flags and non-boolean values. */
export function readFeatureFlagOverrides(): FeatureFlagOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const overrides: FeatureFlagOverrides = {};
    for (const flag of FRONTEND_FEATURE_FLAGS) {
      const value = (parsed as Record<string, unknown>)[flag];
      if (typeof value === "boolean") overrides[flag] = value;
    }
    return overrides;
  } catch {
    return {};
  }
}

/** This browser's answer for one flag, or undefined when the deployment decides. */
export function readFeatureFlagOverride(flag: string): boolean | undefined {
  return (readFeatureFlagOverrides() as Record<string, boolean | undefined>)[flag];
}

function writeOverrides(overrides: FeatureFlagOverrides): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Best effort: storage may be unavailable (private mode, quota).
  }
  notifyListeners();
}

/** Forgets every answer this browser set, so the deployment decides each flag again. */
export function clearAllFeatureFlagOverrides(): void {
  writeOverrides({});
}

/**
 * Applies `?ff_<flag>=on|off|clear`. A link is the only handle on a screen reached before sign-in,
 * and the browser remembers it across an identity provider's redirect. Unknown flags and values are
 * ignored, so a typo never persists as a flag nobody can find to turn off.
 */
export function applyFeatureFlagOverridesFromSearch(search: string): void {
  const params = new URLSearchParams(search);
  const next = { ...readFeatureFlagOverrides() };
  let changed = false;

  for (const flag of FRONTEND_FEATURE_FLAGS) {
    const value = params.get(`ff_${flag}`)?.trim().toLowerCase();
    if (value === undefined) continue;
    if (value === "on" || value === "off") {
      next[flag] = value === "on";
      changed = true;
    } else if (value === "clear") {
      delete next[flag];
      changed = true;
    }
  }

  if (changed) writeOverrides(next);
}

/**
 * The overrides, read on the first render so a flag that picks the screen never
 * paints the other.
 */
export function useFeatureFlagOverrides(): FeatureFlagOverrides {
  const [overrides, setOverrides] = useState<FeatureFlagOverrides>(readFeatureFlagOverrides);

  useEffect(() => {
    const update = () => setOverrides(readFeatureFlagOverrides());
    listeners.add(update);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) update();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return overrides;
}
