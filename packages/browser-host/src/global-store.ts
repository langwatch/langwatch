/**
 * The one UI store. A module declares a slice under its own prefix
 * (`langy:store`, `shell:upgrade-modal`), writes only there, and any module
 * may read any slice. Server data never enters it (tier 1, ARCHITECTURE §10.2).
 */

import { createStore, useStore } from "zustand";

import { BrowserUiStorage } from "./storage.ts";

const root = createStore<Record<string, unknown>>(() => ({}));
const disk = new BrowserUiStorage();
const SLICE_NAME = /^[a-z][a-z0-9-]*:[a-zA-Z][\w-]*$/;

export type SliceUpdate<S> = Partial<S> | ((state: S) => Partial<S>);
export interface SetSlice<S> {
  (update: SliceUpdate<S>): void;
  /** Replace the whole slice, as zustand's `setState(state, true)` does. */
  (update: S, replace: true): void;
}
type Listener<S> = (state: S, previous: S) => void;

/** What any module may do with a slice: read it, hook onto it, subscribe to it. */
export interface SliceReader<S> {
  (): S;
  <T>(selector: (state: S) => T): T;
  readonly sliceName: string;
  getState(): S;
  subscribe(listener: Listener<S>): () => void;
}

/** A slice's owner is the only holder of `setState`. */
export interface Slice<S> extends SliceReader<S> {
  setState: SetSlice<S>;
  getInitialState(): S;
}

// A slice's type is declared by its owner; this is the one place that trusts it.
function narrow<S>(value: unknown): S {
  return value as S;
}

function readerOf<S>({ name, absent }: { name: string; absent?: S }): SliceReader<S> {
  const slice = (all: Record<string, unknown>): S => {
    if (name in all) return narrow<S>(all[name]);
    if (absent !== void 0) return absent;
    throw new Error(`UI slice "${name}" is not defined`);
  };
  const getState = (): S => slice(root.getState());
  function use(): S;
  function use<T>(selector: (state: S) => T): T;
  function use(selector?: (state: S) => unknown): unknown {
    return useStore(root, (all) => (selector ? selector(slice(all)) : slice(all)));
  }
  return Object.assign(use, {
    sliceName: name,
    getState,
    subscribe: (listener: Listener<S>) =>
      root.subscribe((all, previous) => {
        if (all[name] === previous[name]) return;
        listener(narrow<S>(all[name]), narrow<S>(previous[name]));
      }),
  });
}

function hydrate<S>({ key, initial }: { key: string; initial: S }): S {
  const raw = disk.read(key);
  if (!raw) return initial;
  try {
    const parsed: unknown = JSON.parse(raw);
    const saved =
      typeof parsed === "object" && parsed !== null && "state" in parsed ? parsed.state : null;
    return typeof saved === "object" && saved !== null ? { ...initial, ...saved } : initial;
  } catch {
    return initial;
  }
}

/**
 * Declare a slice. `create` receives `set` and `get` scoped to this slice, as in zustand.
 * `persist` keeps the picked keys on this device under `key` (default `name`).
 * Declaring a name twice replaces it (hot reload); the last declaration wins.
 */
export function defineSlice<S extends object>({
  name,
  create,
  persist,
}: {
  name: string;
  create: (set: SetSlice<S>, get: () => S) => S;
  persist?: { key?: string; partialize: (state: S) => Partial<S> };
}): Slice<S> {
  if (!SLICE_NAME.test(name)) {
    throw new Error(`UI slice name "${name}" must be "<module>:<key>"`);
  }
  const get = (): S => narrow<S>(root.getState()[name]);
  const set: SetSlice<S> = (update: SliceUpdate<S>, replace?: boolean) => {
    const previous = get();
    const patch = typeof update === "function" ? update(previous) : update;
    if (Object.is(patch, previous)) return;
    const next = replace ? narrow<S>(patch) : { ...previous, ...patch };
    root.setState({ [name]: next });
    if (persist) {
      disk.write(
        persist.key ?? name,
        JSON.stringify({ state: persist.partialize(next), version: 0 }),
      );
    }
  };
  const initial = create(set, get);
  root.setState({ [name]: persist ? hydrate({ key: persist.key ?? name, initial }) : initial });
  return Object.assign(readerOf<S>({ name }), { setState: set, getInitialState: () => initial });
}

/**
 * Read a slice another module owns; there is no way to write through this.
 * `absent` is what the reader sees where the owner is not installed.
 */
export function readSlice<S>({ name, absent }: { name: string; absent?: S }): SliceReader<S> {
  return readerOf<S>({ name, absent });
}
