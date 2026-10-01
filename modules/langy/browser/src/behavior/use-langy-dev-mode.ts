import { useLangyStore } from "@langwatch/langy-browser-kit";

/**
 * Persistent, per-browser "developer mode" for the Langy panel.
 */
export function useLangyDevMode(): [boolean, (next: boolean) => void] {
  const devMode = useLangyStore((s) => s.devMode);
  const setDevMode = useLangyStore((s) => s.setDevMode);
  return [devMode, setDevMode];
}
