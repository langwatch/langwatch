/**
 * A per-project, per-browser choice to keep the previous simulations screens while the
 * Agent Testing release flag is on for the project.
 * @see specs/suites/new-simulations-callout.feature
 */
import { readUiStorage, removeUiStorage, writeUiStorage } from "@langwatch/ui-host/storage";
import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "langwatch:prefer-legacy-simulations:v1:";
const CHANGE_EVENT = "langwatch:prefer-legacy-simulations-changed";

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

export function isLegacySimulationsPreferred(projectId: string): boolean {
  return readUiStorage(storageKey(projectId)) === "1";
}

export function preferLegacySimulations(projectId: string): void {
  if (typeof window === "undefined") return;
  // A device that will not remember still gets the navigation; the port
  // already answers a refusal as "nothing remembered".
  writeUiStorage(storageKey(projectId), "1");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearLegacySimulationsPreference(projectId: string): void {
  if (typeof window === "undefined") return;
  removeUiStorage(storageKey(projectId));
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

export function useLegacySimulationsPreference(projectId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? isLegacySimulationsPreferred(projectId) : false),
    () => false,
  );
}
