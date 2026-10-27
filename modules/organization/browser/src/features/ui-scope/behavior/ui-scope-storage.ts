/**
 * Where the last resolved scope is remembered — three keys, NOT free
 * choices: `useLocalStorage` reads these exact keys, JSON-string-encoded,
 * and the `local-storage` event lets readers see a write with no reload.
 */

import { isOutOfSpace } from "@langwatch/browser-host/query-persistence";
import type { UiScopeSelection } from "@langwatch/organization-contract";
import { useCallback, useSyncExternalStore } from "react";

import type { UiScopeSelectionWrite } from "./ui-scope-resolution";

export const UI_SELECTED_ORGANIZATION_ID_KEY = "selectedOrganizationId";
export const UI_SELECTED_TEAM_ID_KEY = "selectedTeamId";
export const UI_SELECTED_PROJECT_SLUG_KEY = "selectedProjectSlug";

/** The event `usehooks-ts` broadcasts on every write, and listens for. */
const SAME_DOCUMENT_STORAGE_EVENT = "local-storage";

const WRITE_KEYS: Record<UiScopeSelectionWrite["key"], string> = {
  organizationId: UI_SELECTED_ORGANIZATION_ID_KEY,
  teamId: UI_SELECTED_TEAM_ID_KEY,
  projectSlug: UI_SELECTED_PROJECT_SLUG_KEY,
};

/** Everything one page remembers about where it was working. */
export type UiScopeMemory = {
  readonly selection: UiScopeSelection;
};

const NOTHING_REMEMBERED: UiScopeMemory = {
  selection: { organizationId: "", teamId: "", projectSlug: "" },
};

/** A JSON-encoded string, or "" for anything that is not one. */
function readString(storage: Storage, key: string): string {
  const raw = storage.getItem(key);
  if (raw === null) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

export function readUiScopeMemory(storage: Storage): UiScopeMemory {
  return {
    selection: {
      organizationId: readString(storage, UI_SELECTED_ORGANIZATION_ID_KEY),
      teamId: readString(storage, UI_SELECTED_TEAM_ID_KEY),
      projectSlug: readString(storage, UI_SELECTED_PROJECT_SLUG_KEY),
    },
  };
}

/**
 * Performs the writes a resolution asked for, and tells the document (already guarded, so never
 * a no-op). A write the browser refuses for space is skipped: the memory is a convenience, and
 * this runs in an effect, so a throw would take the page.
 */
export function writeUiScopeSelection({
  writes,
  storage,
  broadcast,
}: {
  writes: readonly UiScopeSelectionWrite[];
  storage: Storage;
  broadcast?: (key: string) => void;
}): void {
  for (const write of writes) {
    const key = WRITE_KEYS[write.key];
    try {
      storage.setItem(key, JSON.stringify(write.value));
    } catch (error) {
      if (isOutOfSpace(error)) continue;
      throw error;
    }
    broadcast?.(key);
  }
}

/**
 * The same writes, against the browser's own storage and broadcast. The one
 * place `window.localStorage` is named for a scope write, so a feature asks
 * for the memory rather than reaching for the global.
 */
export function rememberUiScopeSelection({
  writes,
}: {
  writes: readonly UiScopeSelectionWrite[];
}): void {
  writeUiScopeSelection({
    writes,
    storage: window.localStorage,
    broadcast: broadcastUiScopeWrite,
  });
}

/** The browser's own broadcast, in the shape `usehooks-ts` readers listen for. */
export function broadcastUiScopeWrite(key: string): void {
  window.dispatchEvent(new StorageEvent(SAME_DOCUMENT_STORAGE_EVENT, { key }));
}

/**
 * The remembered scope as this document last read it: read when its first reader mounts, then
 * again only on a write in this document. Another tab's write is ignored, even on a later
 * render, so two tabs in two scopes never take each other's (tasks#987).
 */
class UiScopeMemoryStore {
  private cached: UiScopeMemory = NOTHING_REMEMBERED;
  private stale = true;
  private readers = 0;

  constructor(private readonly storage: Storage) {}

  snapshot = (): UiScopeMemory => {
    if (!this.stale) return this.cached;
    this.stale = false;
    this.cached = readUiScopeMemory(this.storage);
    return this.cached;
  };

  subscribe = (listener: () => void): (() => void) => {
    const onWrite = () => {
      this.stale = true;
      listener();
    };
    if (this.readers === 0) this.stale = true;
    this.readers += 1;
    window.addEventListener(SAME_DOCUMENT_STORAGE_EVENT, onWrite);
    return () => {
      this.readers -= 1;
      window.removeEventListener(SAME_DOCUMENT_STORAGE_EVENT, onWrite);
    };
  };
}

const stores = new WeakMap<Storage, UiScopeMemoryStore>();

function storeFor(storage: Storage): UiScopeMemoryStore {
  const known = stores.get(storage);
  if (known) return known;
  const store = new UiScopeMemoryStore(storage);
  stores.set(storage, store);
  return store;
}

/** What the last page left behind, kept current for this render. */
export function useUiScopeMemory(storage: Storage = window.localStorage): UiScopeMemory {
  const store = storeFor(storage);
  const snapshot = useCallback(() => store.snapshot(), [store]);
  return useSyncExternalStore(store.subscribe, snapshot, () => NOTHING_REMEMBERED);
}
