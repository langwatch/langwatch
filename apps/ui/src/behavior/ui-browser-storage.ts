/**
 * Web Storage and a console logger, as capabilities a frontend feature
 * asks for — a feature may not name `window` directly. Read through a
 * getter, not captured once, since `window` isn't guaranteed at import time.
 */

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

export const browserUiStorage: UiBrowserStorage = {
  get length() {
    return window.localStorage.length;
  },
  key: (index: number) => window.localStorage.key(index),
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  removeItem: (key: string) => window.localStorage.removeItem(key),
};

/**
 * Per-TAB storage, for state that must not outlive the visit — a lead
 * source belongs to the visit that produced the signup, and a value that
 * survived the tab would attribute a later signup to a stale campaign.
 */
export const browserUiSessionStorage: UiBrowserStorage = {
  get length() {
    return window.sessionStorage.length;
  },
  key: (index: number) => window.sessionStorage.key(index),
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};

export const browserUiLogger: UiBrowserLogger = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
