import { useCallback, useEffect, useState } from "react";

/**
 * Per-browser opt-in flag for the new Trace Explorer drawer. Set the
 * first time the operator clicks "Try the new one" on the v1 banner,
 * and cleared when they choose "Go back to old trace visualization"
 * from the v2 drawer's overflow menu.
 *
 * Kept as plain localStorage rather than a server-side preference
 * because (a) we want the choice to stick instantly without a
 * round-trip and (b) it's a per-device tactile choice, not a
 * cross-device preference — different browsers can land on different
 * sides of the rollout without the operator having to manage it.
 */
const STORAGE_KEY = "langwatch:traces-v2-preferred";

export function getTracesV2Preferred(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTracesV2Preferred(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
    // Same-tab subscribers don't get a `storage` event from the
    // setter, so fan it out manually. Cross-tab subscribers still
    // get the native event from the browser.
    window.dispatchEvent(new CustomEvent("langwatch:traces-v2-pref-changed"));
  } catch {
    // best-effort — Safari private mode etc.
  }
}

/**
 * React hook variant. Returns the current preference plus mutators.
 * Subscribes to same-tab and cross-tab changes so every consumer
 * stays in sync without prop drilling.
 */
export function useTracesV2Preference(): {
  preferred: boolean;
  enable: () => void;
  disable: () => void;
} {
  const [preferred, setPreferred] = useState(false);

  useEffect(() => {
    setPreferred(getTracesV2Preferred());
    const sync = () => setPreferred(getTracesV2Preferred());
    window.addEventListener("storage", sync);
    window.addEventListener("langwatch:traces-v2-pref-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("langwatch:traces-v2-pref-changed", sync);
    };
  }, []);

  const enable = useCallback(() => setTracesV2Preferred(true), []);
  const disable = useCallback(() => setTracesV2Preferred(false), []);

  return { preferred, enable, disable };
}
