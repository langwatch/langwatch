/**
 * The graphics-quality override a screen may not keep in storage itself:
 * one persisted value, its listeners, and the FPS-sample decision (10.1).
 */

import { createContext, useContext, useSyncExternalStore } from "react";

import { readUiStorage, writeUiStorage } from "./storage.ts";

/** Manual escape hatch on top of the automatic FPS probe. */
export type GraphicsQualityOverride = "auto" | "on" | "off";

const GRAPHICS_QUALITY_STORAGE_KEY = "langwatch:graphics-quality-override:v1";
const DEFAULT_GRAPHICS_QUALITY_OVERRIDE: GraphicsQualityOverride = "auto";

function isGraphicsQualityOverride(value: string | undefined): value is GraphicsQualityOverride {
  return value === "auto" || value === "on" || value === "off";
}

function readStoredOverride(): GraphicsQualityOverride {
  const raw = readUiStorage(GRAPHICS_QUALITY_STORAGE_KEY);
  return isGraphicsQualityOverride(raw) ? raw : DEFAULT_GRAPHICS_QUALITY_OVERRIDE;
}

let graphicsQuality: GraphicsQualityOverride = readStoredOverride();
const graphicsQualityListeners = new Set<() => void>();

function notifyGraphicsQuality(): void {
  graphicsQualityListeners.forEach((listener) => listener());
}

function subscribeGraphicsQualityOverride(onChange: () => void): () => void {
  graphicsQualityListeners.add(onChange);
  return () => graphicsQualityListeners.delete(onChange);
}

export function setGraphicsQualityOverride(next: GraphicsQualityOverride): void {
  graphicsQuality = next;
  writeUiStorage(GRAPHICS_QUALITY_STORAGE_KEY, next);
  notifyGraphicsQuality();
}

/** For tests: resets the in-memory override without touching storage. */
export function resetGraphicsQualityOverrideForTests(
  value: GraphicsQualityOverride = DEFAULT_GRAPHICS_QUALITY_OVERRIDE,
): void {
  graphicsQuality = value;
  notifyGraphicsQuality();
}

export function useGraphicsQualityOverrideStore(): GraphicsQualityOverride {
  return useSyncExternalStore(subscribeGraphicsQualityOverride, () => graphicsQuality);
}

/**
 * Whether the app is in reduced-graphics mode, for a consumer that needs
 * the signal in JS. Falls back to `false` when no provider is mounted.
 */
export const GraphicsQualityContext = createContext<{ reducedGraphics: boolean }>({
  reducedGraphics: false,
});

export function useGraphicsQuality(): { reducedGraphics: boolean } {
  return useContext(GraphicsQualityContext);
}

/**
 * Evaluates a single frame-rate sample window against a floor. Pure, so the
 * graphics-quality probe's struggling/smooth math is testable without a browser.
 */
export function evaluateFpsSample({
  frames,
  elapsedMs,
  minFps,
}: {
  frames: number;
  elapsedMs: number;
  minFps: number;
}): boolean {
  if (elapsedMs <= 0) return true;
  const fps = (frames / elapsedMs) * 1000;
  return fps < minFps;
}
