import { useEffect, useSyncExternalStore } from "react";
import type { FrontDoorDepth, FrontDoorDoor, FrontDoorStage } from "./ground-palette.ts";

/** Module-scoped store: tracks current door/depth for ground animation. */

const INITIAL: FrontDoorStage = { door: "signin", depth: "entry" };

let stage: FrontDoorStage = INITIAL;
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
export function useFrontDoorStage(): FrontDoorStage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Publish where this screen is; no reset on unmount to avoid field flash. */
export function usePublishFrontDoorStage(next: {
  door: FrontDoorDoor;
  depth: FrontDoorDepth;
}): void {
  const { door, depth } = next;

  useEffect(() => {
    if (stage.door === door && stage.depth === depth) return;
    stage = { door, depth };
    for (const listener of listeners) listener();
  }, [door, depth]);
}

/** Test seam: the store outlives a render, so a suite has to reset it. */
export function _resetFrontDoorStageForTests(): void {
  stage = INITIAL;
  listeners.clear();
}
