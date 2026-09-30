import { useSyncExternalStore } from "react";

/**
 * Whether the auth screens' entrance is still moving.
 *
 * It exists for exactly one decision: when to take focus. Focusing a field
 * while the card is still rising drags the page under the animation on a
 * phone, and focusing it after the motion has finished is invisible. Nothing
 * else waits on this — the fields are mounted, live and typeable from the
 * first frame, and a keystroke that arrives mid-entrance is simply typed.
 *
 * A module-scoped store rather than a context, because the components that ask
 * are also rendered on their own (an invitation landing, a test) where no
 * shell has ever mounted. The answer there is "nothing is playing", which is
 * both true and the right behavior.
 */
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
