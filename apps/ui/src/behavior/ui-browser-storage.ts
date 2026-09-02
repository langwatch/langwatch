/**
 * Web Storage and a console logger, as capabilities a frontend feature can ask
 * for.
 *
 * A frontend feature may not name a browser global — `ui-browser-capability`
 * says so, and it is right to: a feature that reaches `window` directly cannot
 * be mounted anywhere else. The global layer can, which is where
 * `ui-scope-storage.ts` already keeps the application's own selection memory.
 *
 * The storage is read through a getter rather than captured once: this module
 * is on the boot graph and `window` is not guaranteed to exist at import time,
 * while every call that reaches it happens in a render or an event handler.
 *
 * The logger is the console. `@langwatch/observability` is a first-party
 * implementation package a frontend feature may not import either, and what
 * this logs — a corrupt or missing record in a feature's own persisted state —
 * is a developer's problem rather than a customer's.
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
 * Per-TAB storage, for state that must not outlive the visit.
 *
 * The CLI authorize screen's first-touch acquisition stamp lives here rather
 * than in `localStorage`, because that is where `platform/app`'s attribution
 * module put it: a lead source belongs to the visit that produced the signup,
 * and a value that survived the tab would attribute a later signup to a campaign
 * the reader arrived on weeks ago.
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
