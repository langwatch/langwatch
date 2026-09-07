import { useEffect, useSyncExternalStore } from "react";
import type { AuthDepth, AuthDoor, AuthStage } from "./groundPalette";

/**
 * Where in the auth screens somebody currently is, for the one thing that wants
 * to know: the ground behind the card.
 *
 * A module-scoped store rather than context, for the same reason
 * `entrance.ts` is one — the screens that publish a stage are also rendered on
 * their own, in tests and on an invitation landing, where no shell has ever
 * mounted. The answer there is "the address step of the log-in door", which is
 * both true and the right-looking field.
 *
 * It is deliberately one-way. The ground READS this; nothing reads the ground.
 * A screen says where it is and stops caring, which is what keeps the field a
 * decoration rather than a dependency: delete the ground and every door still
 * works, unchanged.
 */

const INITIAL: AuthStage = { door: "signin", depth: "entry" };

let stage: AuthStage = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => stage;
const getServerSnapshot = () => INITIAL;

/** The field's current setting. */
export function useAuthStage(): AuthStage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Say where this screen is. Called unconditionally, at the top of a door,
 * with a depth derived from the state that door already keeps — so the ground
 * can never disagree with what is drawn over it.
 *
 * Nothing is published on unmount. A door that leaves is a door being replaced
 * by the app, and resetting the field on the way out would flash it back to
 * the address step over the top of somebody's redirect.
 */
export function usePublishAuthStage(next: {
  door: AuthDoor;
  depth: AuthDepth;
}): void {
  const { door, depth } = next;

  useEffect(() => {
    if (stage.door === door && stage.depth === depth) return;
    stage = { door, depth };
    for (const listener of listeners) listener();
  }, [door, depth]);
}

/** Test seam: the store outlives a render, so a suite has to reset it. */
export function _resetAuthStageForTests(): void {
  stage = INITIAL;
  listeners.clear();
}
