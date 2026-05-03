import type { PipelineNode } from "~/server/app-layer/ops/types";

export function isNodePaused(
  node: PipelineNode,
  parentPath: string,
  pausedKeys: Set<string>,
): boolean {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (pausedKeys.has(path)) return true;
  if (parentPath) {
    const segments = parentPath.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const ancestor = segments.slice(0, i).join("/");
      if (pausedKeys.has(ancestor)) return true;
    }
  }
  return false;
}

export function isNodeDirectlyPaused(
  nodePath: string,
  pausedKeys: Set<string>,
): boolean {
  return pausedKeys.has(nodePath);
}

