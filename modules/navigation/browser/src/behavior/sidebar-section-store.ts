/**
 * The imperative half of sidebar group state: a peer module (through the
 * `sidebar` capability) can force a group open or closed, on top of the
 * device's remembered preference `useSidebarSectionState` already owns.
 */

type Listener = () => void;

const overrides = new Map<string, boolean>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getSidebarSectionOverride(id: string): boolean | undefined {
  return overrides.get(id);
}

export function subscribeSidebarSectionOverrides(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSidebarSectionOverride(id: string, expanded: boolean): void {
  overrides.set(id, expanded);
  notify();
}

/** Drops every override, so each group falls back to its remembered preference. */
export function clearSidebarSectionOverrides(): void {
  overrides.clear();
  notify();
}
