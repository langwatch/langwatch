/**
 * The one place a browser feature remembers something on this device. A
 * feature may not name `localStorage` directly; with no port installed,
 * it degrades to remembering nothing rather than failing.
 */

export abstract class UiStoragePort {
  abstract read(key: string): string | undefined;
  abstract write(key: string, value: string): void;
  abstract remove(key: string): void;
}

let installed: UiStoragePort | undefined;

/** Called by whatever mounts the UI shell, and cleared on unmount. */
export function setUiStorage(port: UiStoragePort | undefined): void {
  installed = port;
}

/** The remembered value, or nothing at all. */
export function readUiStorage(key: string): string | undefined {
  return installed?.read(key);
}

/** Remembers a value on this device, where the shell offers somewhere to put it. */
export function writeUiStorage(key: string, value: string): void {
  installed?.write(key, value);
}

/** Forgets a value on this device. */
export function removeUiStorage(key: string): void {
  installed?.remove(key);
}

/**
 * The browser's own store, for the shell and for tests wanting the same
 * behavior. Every accessor can throw, so a refusal reads as "nothing
 * remembered" rather than taking the screen down with it.
 */
export class BrowserUiStorage extends UiStoragePort {
  read(key: string): string | undefined {
    try {
      return globalThis.localStorage?.getItem(key) ?? void 0;
    } catch {
      return void 0;
    }
  }

  write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // A device that will not remember is not a failure the reader can act on.
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // As above.
    }
  }
}
