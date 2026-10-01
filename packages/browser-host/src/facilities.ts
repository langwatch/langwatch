/**
 * The device globals a screen may not name directly, behind one class —
 * clipboard, storage, downloads, motion and graphics quality. Composed by
 * the shell via `setUiFacilities`; the real browser is the default (10.1).
 */

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { readUiStorage, writeUiStorage } from "./storage.ts";

/** The subset of Web Storage a persisted feature state needs, enumeration included. */
export type UiBrowserStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Structured diagnostics, in the field-then-message shape the product logs in. */
export type UiBrowserLogger = {
  info(message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

/** Manual escape hatch on top of the automatic FPS probe. */
export type GraphicsQualityOverride = "auto" | "on" | "off";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const GRAPHICS_QUALITY_STORAGE_KEY = "langwatch:graphics-quality-override:v1";
const DEFAULT_GRAPHICS_QUALITY_OVERRIDE: GraphicsQualityOverride = "auto";

function isGraphicsQualityOverride(value: string | undefined): value is GraphicsQualityOverride {
  return value === "auto" || value === "on" || value === "off";
}

export abstract class UiFacilities {
  abstract writeClipboard(text: string): Promise<void>;
  abstract localStorage(): UiBrowserStorage;
  abstract sessionStorage(): UiBrowserStorage;
  abstract logger(): UiBrowserLogger;
  abstract downloadFile(file: { fileName: string; contents: string; mediaType: string }): void;
  abstract prefersReducedMotion(): boolean;
  abstract subscribeReducedMotion(onChange: () => void): () => void;
  abstract graphicsQualityOverride(): GraphicsQualityOverride;
  abstract setGraphicsQualityOverride(next: GraphicsQualityOverride): void;
  abstract subscribeGraphicsQualityOverride(onChange: () => void): () => void;
}

/** The real browser, behind the one door a feature is allowed through. */
export class BrowserUiFacilities extends UiFacilities {
  static create(): BrowserUiFacilities {
    return new BrowserUiFacilities();
  }

  private graphicsQuality: GraphicsQualityOverride = (() => {
    const raw = readUiStorage(GRAPHICS_QUALITY_STORAGE_KEY);
    return isGraphicsQualityOverride(raw) ? raw : DEFAULT_GRAPHICS_QUALITY_OVERRIDE;
  })();
  private readonly graphicsQualityListeners = new Set<() => void>();

  private constructor() {
    super();
  }

  /** REJECTS rather than answering false: a write can be refused, with a reason to log. */
  writeClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
  }

  localStorage(): UiBrowserStorage {
    return {
      get length() {
        return window.localStorage.length;
      },
      key: (index: number) => window.localStorage.key(index),
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
      removeItem: (key: string) => window.localStorage.removeItem(key),
    };
  }

  /**
   * Per-TAB storage, for state that must not outlive the visit — a lead
   * source belongs to the visit that produced the signup.
   */
  sessionStorage(): UiBrowserStorage {
    return {
      get length() {
        return window.sessionStorage.length;
      },
      key: (index: number) => window.sessionStorage.key(index),
      getItem: (key: string) => window.sessionStorage.getItem(key),
      setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
      removeItem: (key: string) => window.sessionStorage.removeItem(key),
    };
  }

  logger(): UiBrowserLogger {
    return {
      info: (...args: unknown[]) => console.info(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      error: (...args: unknown[]) => console.error(...args),
    };
  }

  /** ORDER IS LOAD-BEARING: click before revoke, or Chrome cancels the save. */
  downloadFile({
    fileName,
    contents,
    mediaType,
  }: {
    fileName: string;
    contents: string;
    mediaType: string;
  }): void {
    const url = URL.createObjectURL(new Blob([contents], { type: mediaType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.setAttribute("download", fileName);
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }

  /** An unsupported `matchMedia` reads as "no preference". */
  prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia(REDUCED_MOTION_QUERY).matches;
    } catch {
      return false;
    }
  }

  subscribeReducedMotion(onChange: () => void): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => {
        /* noop */
      };
    }
    let media: MediaQueryList;
    try {
      media = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return () => {
        /* noop */
      };
    }
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }

  graphicsQualityOverride(): GraphicsQualityOverride {
    return this.graphicsQuality;
  }

  setGraphicsQualityOverride(next: GraphicsQualityOverride): void {
    this.graphicsQuality = next;
    writeUiStorage(GRAPHICS_QUALITY_STORAGE_KEY, next);
    this.graphicsQualityListeners.forEach((listener) => listener());
  }

  subscribeGraphicsQualityOverride(onChange: () => void): () => void {
    this.graphicsQualityListeners.add(onChange);
    return () => this.graphicsQualityListeners.delete(onChange);
  }

  /** For tests: resets the in-memory override without touching storage. */
  resetGraphicsQualityOverrideForTests(
    value: GraphicsQualityOverride = DEFAULT_GRAPHICS_QUALITY_OVERRIDE,
  ): void {
    this.graphicsQuality = value;
    this.graphicsQualityListeners.forEach((listener) => listener());
  }
}

const DEFAULT_UI_FACILITIES = BrowserUiFacilities.create();
let installed: UiFacilities | undefined;

/** Called by whatever mounts the UI shell, and cleared on unmount. */
export function setUiFacilities(port: UiFacilities | undefined): void {
  installed = port;
}

function activeFacilities(): UiFacilities {
  return installed ?? DEFAULT_UI_FACILITIES;
}

export function writeUiClipboard(text: string): Promise<void> {
  return activeFacilities().writeClipboard(text);
}

export const browserUiStorage: UiBrowserStorage = {
  get length() {
    return activeFacilities().localStorage().length;
  },
  key: (index: number) => activeFacilities().localStorage().key(index),
  getItem: (key: string) => activeFacilities().localStorage().getItem(key),
  setItem: (key: string, value: string) => activeFacilities().localStorage().setItem(key, value),
  removeItem: (key: string) => activeFacilities().localStorage().removeItem(key),
};

export const browserUiSessionStorage: UiBrowserStorage = {
  get length() {
    return activeFacilities().sessionStorage().length;
  },
  key: (index: number) => activeFacilities().sessionStorage().key(index),
  getItem: (key: string) => activeFacilities().sessionStorage().getItem(key),
  setItem: (key: string, value: string) => activeFacilities().sessionStorage().setItem(key, value),
  removeItem: (key: string) => activeFacilities().sessionStorage().removeItem(key),
};

type UiBrowserLoggerArgs = [string] | [Record<string, unknown>, string];

function logAtLevel(level: "info" | "warn" | "error", args: UiBrowserLoggerArgs): void {
  const logger = activeFacilities().logger();
  if (args.length === 1) {
    logger[level](args[0]);
  } else {
    logger[level](args[0], args[1]);
  }
}

export const browserUiLogger: UiBrowserLogger = {
  info: (...args: UiBrowserLoggerArgs) => logAtLevel("info", args),
  warn: (...args: UiBrowserLoggerArgs) => logAtLevel("warn", args),
  error: (...args: UiBrowserLoggerArgs) => logAtLevel("error", args),
};

export function downloadUiFile(file: {
  fileName: string;
  contents: string;
  mediaType: string;
}): void {
  activeFacilities().downloadFile(file);
}

export function readUiPrefersReducedMotion(): boolean {
  return activeFacilities().prefersReducedMotion();
}

/** LISTENS rather than reading once — the OS preference can change while a page is open. */
export function useUiPrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readUiPrefersReducedMotion);

  useEffect(() => {
    setReduced(activeFacilities().prefersReducedMotion());
    return activeFacilities().subscribeReducedMotion(() =>
      setReduced(activeFacilities().prefersReducedMotion()),
    );
  }, []);

  return reduced;
}

export function setGraphicsQualityOverride(next: GraphicsQualityOverride): void {
  activeFacilities().setGraphicsQualityOverride(next);
}

export function resetGraphicsQualityOverrideForTests(
  value: GraphicsQualityOverride = DEFAULT_GRAPHICS_QUALITY_OVERRIDE,
): void {
  DEFAULT_UI_FACILITIES.resetGraphicsQualityOverrideForTests(value);
}

export function useGraphicsQualityOverrideStore(): GraphicsQualityOverride {
  return useSyncExternalStore(
    (listener) => activeFacilities().subscribeGraphicsQualityOverride(listener),
    () => activeFacilities().graphicsQualityOverride(),
  );
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
