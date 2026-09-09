/**
 * The browser services Prompt Studio needs but does not own.
 *
 * An owner-only screen receives its browser capabilities from the application
 * that mounts it rather than reaching for the globals itself, so the same
 * screen runs against real Web Storage in the product and against an in-memory
 * double in a test without a jsdom shim standing in for composition.
 */

/**
 * A key-value store with the shape of Web Storage, including enumeration:
 * prompt tab state is written under one key per tab, and cleaning a project up
 * means scanning for the keys that belong to it.
 */
export interface PromptBrowserStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Structured diagnostics, in the field-then-message shape the app logs in. */
export interface PromptBrowserLogger {
  info(message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/** Everything the persisted prompt tab state needs from the browser. */
export interface PromptTabsCapabilities {
  storage: PromptBrowserStorage;
  logger: PromptBrowserLogger;
}
