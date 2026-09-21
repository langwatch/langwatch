import { useEffect, useState } from "react";
import {
  FRONTEND_FEATURE_FLAGS,
  type FrontendFeatureFlag,
} from "../server/featureFlag/frontendFeatureFlags";

const STORAGE_KEY = "langwatch:dev:feature-flag-overrides";

export type FeatureFlagOverrides = Partial<
  Record<FrontendFeatureFlag, boolean>
>;

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
 * Applies `?ff_<flag>=on|off|clear` to this browser's overrides.
 *
 * A URL is the only handle somebody has on a screen they reach before signing
 * in: the server-side flag check is a protected procedure, so signed out it
 * answers 401 rather than false. Setting it from a link, once, and having the
 * browser remember is what survives the redirect back from an identity
 * provider. `clear` returns a flag to whatever the deployment says.
 *
 * Unknown flags and unrecognized values are ignored rather than stored — a
 * typo that persisted would be a flag nobody can find again to turn off.
 */
export function applyFeatureFlagOverridesFromSearch(search: string): void {
  const params = new URLSearchParams(search);
  const next = { ...readOverrides() };
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
 * Subscribe to local feature-flag overrides.
 *
 * Read on the FIRST render, not from an effect. Some of these flags decide
 * which screen a route renders rather than what a rendered screen shows, and
 * an effect runs after the first paint — so those callers would paint the
 * unflagged screen and then swap. `readOverrides` already answers `{}` when
 * there is no `window`, which is what the deferred read was guarding.
 */
export function useFeatureFlagOverrides(): FeatureFlagOverrides {
  const [overrides, setOverrides] =
    useState<FeatureFlagOverrides>(readOverrides);

  useEffect(() => {
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
