/**
 * Where the last resolved scope is remembered — three keys, NOT free
 * choices: `useLocalStorage` reads these exact keys, JSON-string-encoded,
 * and the `local-storage` event lets readers see a write with no reload.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { UiScopeSelection } from "../model/ui-scope";
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
 * Performs the writes a resolution asked for, and tells the document —
 * already guarded, so this loop never broadcasts a no-op.
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
    storage.setItem(key, JSON.stringify(write.value));
    broadcast?.(key);
  }
}

/** The browser's own broadcast, in the shape `usehooks-ts` readers listen for. */
export function broadcastUiScopeWrite(key: string): void {
  window.dispatchEvent(new StorageEvent(SAME_DOCUMENT_STORAGE_EVENT, { key }));
}

/**
 * The remembered scope, re-read on every document write — cached against
 * the raw strings so React sees a stable value; a fresh object every
 * read would make `useSyncExternalStore` re-render forever.
 */
class UiScopeMemoryStore {
  private raw = "";
  private cached: UiScopeMemory = NOTHING_REMEMBERED;
  private read = false;

  constructor(private readonly storage: Storage) {}

  snapshot = (): UiScopeMemory => {
    const raw = [
      this.storage.getItem(UI_SELECTED_ORGANIZATION_ID_KEY),
      this.storage.getItem(UI_SELECTED_TEAM_ID_KEY),
      this.storage.getItem(UI_SELECTED_PROJECT_SLUG_KEY),
    ].join(" ");
    if (this.read && raw === this.raw) return this.cached;
    this.raw = raw;
    this.read = true;
    this.cached = readUiScopeMemory(this.storage);
    return this.cached;
  };

  subscribe = (listener: () => void): (() => void) => {
    window.addEventListener("storage", listener);
    window.addEventListener(SAME_DOCUMENT_STORAGE_EVENT, listener);
    return () => {
      window.removeEventListener("storage", listener);
      window.removeEventListener(SAME_DOCUMENT_STORAGE_EVENT, listener);
    };
  };
}

let sharedStore: UiScopeMemoryStore | undefined;

function storeFor(storage: Storage): UiScopeMemoryStore {
  if (storage !== window.localStorage) return new UiScopeMemoryStore(storage);
  sharedStore ??= new UiScopeMemoryStore(storage);
  return sharedStore;
}

/** What the last page left behind, kept current for this render. */
export function useUiScopeMemory(storage: Storage = window.localStorage): UiScopeMemory {
  const store = storeFor(storage);
  const snapshot = useCallback(() => store.snapshot(), [store]);
  return useSyncExternalStore(store.subscribe, snapshot, () => NOTHING_REMEMBERED);
}
