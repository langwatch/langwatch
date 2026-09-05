/**
 * Manual escape hatch on top of the automatic FPS probe (auto/on/off), a
 * per-device preference read/written through the shell's storage port.
 */
import { useSyncExternalStore } from "react";
import { readUiStorage, writeUiStorage } from "@langwatch/ui-host/storage";

export type GraphicsQualityOverride = "auto" | "on" | "off";

const STORAGE_KEY = "langwatch:graphics-quality-override:v1";
const DEFAULT_OVERRIDE: GraphicsQualityOverride = "auto";

function isOverride(value: string | undefined): value is GraphicsQualityOverride {
  return value === "auto" || value === "on" || value === "off";
}

let state: GraphicsQualityOverride = (() => {
  const raw = readUiStorage(STORAGE_KEY);
  return isOverride(raw) ? raw : DEFAULT_OVERRIDE;
})();
const listeners = new Set<() => void>();

function getSnapshot(): GraphicsQualityOverride {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sets the override and remembers it on this device. */
export function setGraphicsQualityOverride(next: GraphicsQualityOverride): void {
  state = next;
  writeUiStorage(STORAGE_KEY, next);
  listeners.forEach((listener) => listener());
}

/** For tests: resets the in-memory override without touching storage. */
export function resetGraphicsQualityOverrideForTests(
  value: GraphicsQualityOverride = DEFAULT_OVERRIDE,
): void {
  state = value;
  listeners.forEach((listener) => listener());
}

export function useGraphicsQualityOverrideStore(): GraphicsQualityOverride {
  return useSyncExternalStore(subscribe, getSnapshot);
}
