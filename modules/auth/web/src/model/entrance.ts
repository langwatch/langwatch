import { useSyncExternalStore } from "react";

/** Module-scoped store: tracks entrance animation to know when to focus fields. */
let entranceIsPlaying = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Called by the entrance itself, around the motion it plays. */
export function beginEntrance(): void {
  entranceIsPlaying = true;
  publish();
}

export function endEntrance(): void {
  entranceIsPlaying = false;
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => !entranceIsPlaying;
const getServerSnapshot = () => true;

/** True once nothing is animating, which is immediately in most cases. */
export function useEntranceSettled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: the store outlives a render, so a suite has to reset it. */
export function _resetEntranceForTests(): void {
  entranceIsPlaying = false;
  listeners.clear();
}
