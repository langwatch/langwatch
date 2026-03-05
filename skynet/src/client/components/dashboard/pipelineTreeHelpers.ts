import type { PipelineNode } from "../../../shared/types.ts";

/** Collect all leaf pipeline names under a node */
export function collectLeafNames(node: PipelineNode): string[] {
  if (node.children.length === 0) return [node.name];
  return node.children.flatMap(collectLeafNames);
}

/** Build the hierarchical path for a node at each level of the tree. */
export function buildPauseKey({ ancestors, name }: { ancestors: string[]; name: string }): string {
  return [...ancestors, name].join("/");
}

/** Check if a key is paused (direct match or any ancestor matches). */
export function isPausedKey({ pauseKey, pausedKeys }: { pauseKey: string; pausedKeys: string[] }): boolean {
  return pausedKeys.some(
    (k) => k === pauseKey || pauseKey.startsWith(k + "/"),
  );
}

/** Check if the pause is inherited from an ancestor rather than set directly. */
export function isInheritedPause({ pauseKey, pausedKeys }: { pauseKey: string; pausedKeys: string[] }): boolean {
  return (
    !pausedKeys.includes(pauseKey) &&
    pausedKeys.some((k) => pauseKey.startsWith(k + "/"))
  );
}
