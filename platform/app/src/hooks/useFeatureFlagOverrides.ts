import { useEffect, useState } from "react";
import {
  FRONTEND_FEATURE_FLAGS,
  type FrontendFeatureFlag,
} from "../server/featureFlag/frontendFeatureFlags";

const STORAGE_KEY = "langwatch:dev:feature-flag-overrides";

export type FeatureFlagOverrides = Partial<Record<FrontendFeatureFlag, boolean>>;

// Same-tab subscribers — `storage` events only fire on *other* tabs, so we
// fan out our own writes to consumers in the current tab.
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

function readOverrides(): FeatureFlagOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: FeatureFlagOverrides = {};
    for (const flag of FRONTEND_FEATURE_FLAGS) {
      const value = (parsed as Record<string, unknown>)[flag];
      if (typeof value === "boolean") out[flag] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: FeatureFlagOverrides): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Best-effort: localStorage may be unavailable (privacy mode, quota).
  }
  notifyListeners();
}

export function setFeatureFlagOverride(
  flag: FrontendFeatureFlag,
  value: boolean | undefined,
): void {
  const next = { ...readOverrides() };
  if (value === undefined) {
    delete next[flag];
  } else {
    next[flag] = value;
  }
  writeOverrides(next);
}

export function clearAllFeatureFlagOverrides(): void {
  writeOverrides({});
}

/**
 * Subscribe to local feature-flag overrides. Returns an empty object during
 * SSR / first render to avoid hydration mismatches; the real value populates
 * on mount via the effect below.
 */
export function useFeatureFlagOverrides(): FeatureFlagOverrides {
  const [overrides, setOverrides] = useState<FeatureFlagOverrides>({});

  useEffect(() => {
    setOverrides(readOverrides());

    const update = () => setOverrides(readOverrides());
    listeners.add(update);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) update();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return overrides;
}
