/**
 * A per-project, per-browser choice to keep the previous simulations screens
 * while the Agent Testing release flag is on for the project.
 *
 * The person who clicks "go back" on the welcome callout gets the previous
 * screens on this machine only: the sidebar offers the Simulations group
 * again and `/simulations` addresses stop redirecting to Agent Testing.
 * Everyone else on the project keeps the new screens.
 *
 * The write dispatches {@link CHANGE_EVENT} so every mounted reader (the
 * main menu above all) re-reads without a page load; the `storage` event
 * covers a second tab of the same browser.
 *
 * @see specs/suites/new-simulations-callout.feature
 */
import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "langwatch:prefer-legacy-simulations:v1:";
const CHANGE_EVENT = "langwatch:prefer-legacy-simulations-changed";

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

export function isLegacySimulationsPreferred(projectId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(storageKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function preferLegacySimulations(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), "1");
  } catch {
    // A blocked localStorage still gets the navigation, just not the
    // persistent preference.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLegacySimulationsPreference(
  projectId: string | undefined,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? isLegacySimulationsPreferred(projectId) : false),
    () => false,
  );
}
