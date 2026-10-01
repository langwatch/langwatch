/**
 * The one place a browser feature remembers something on this device. A
 * feature may not name `localStorage` directly; with no port installed,
 * it degrades to remembering nothing rather than failing.
 */

export abstract class UiStorage {
  abstract read(key: string): string | undefined;
  abstract write(key: string, value: string): void;
  abstract remove(key: string): void;
}

let installed: UiStorage | undefined;

/** Called by whatever mounts the UI shell, and cleared on unmount. */
export function setUiStorage(port: UiStorage | undefined): void {
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
export class BrowserUiStorage extends UiStorage {
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
      return;
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // As above.
      return;
    }
  }

  keys(): string[] {
    try {
      const store = globalThis.localStorage;
      if (!store) return [];
      return Array.from({ length: store.length }, (_, index) => store.key(index) ?? "");
    } catch {
      return [];
    }
  }
}

/** Every key a person's own choices are kept under starts with this. */
const READER_PREFIX = "langwatch:user:";
const device = new BrowserUiStorage();
const readerListeners = new Set<() => void>();
let reader: string | undefined;

function readerPrefix(): string | undefined {
  return reader === undefined ? void 0 : `${READER_PREFIX}${encodeURIComponent(reader)}:`;
}

function readerKeys(): string[] {
  const prefix = readerPrefix();
  if (prefix === undefined) return [];
  return device
    .keys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

/** Who the remembered choices belong to, set as the session answers; with nobody, none are kept. */
export function setUiStorageReader(userId: string | undefined): void {
  if (reader === userId) return;
  reader = userId;
  for (const listener of readerListeners) listener();
}

/** Told whenever the reader changes, so each persisted slice reloads the new reader's choices. */
export function onUiStorageReaderChange(listener: () => void): () => void {
  readerListeners.add(listener);
  return () => readerListeners.delete(listener);
}

/**
 * Web Storage's shape over the signed-in reader's own keys: preferences only,
 * never server data (ARCHITECTURE §10.2). With nobody signed in it holds nothing.
 */
export const readerUiStorage = {
  get length(): number {
    return readerKeys().length;
  },
  key: (index: number): string | null => readerKeys()[index] ?? null,
  getItem: (key: string): string | null => {
    const prefix = readerPrefix();
    return prefix === undefined ? null : (device.read(prefix + key) ?? null);
  },
  setItem: (key: string, value: string): void => {
    const prefix = readerPrefix();
    if (prefix !== undefined) device.write(prefix + key, value);
  },
  removeItem: (key: string): void => {
    const prefix = readerPrefix();
    if (prefix !== undefined) device.remove(prefix + key);
  },
};

/**
 * Sign-out: everything this tab kept in session storage (drafts, PKCE verifiers, attribution).
 * The keys share no prefix, and the origin is ours, so the whole tab store goes.
 */
export function clearSessionUiStorage(): void {
  try {
    globalThis.sessionStorage?.clear();
  } catch {
    // A tab that refuses session storage holds nothing to clear.
    return;
  }
}

/** Sign-out: forgets who was reading and every reader's remembered choices on this device. */
export function clearReaderUiStorage(): void {
  setUiStorageReader(void 0);
  for (const key of device.keys()) {
    if (key.startsWith(READER_PREFIX)) device.remove(key);
  }
}
