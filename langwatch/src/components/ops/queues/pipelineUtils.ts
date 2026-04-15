import type { GroupInfo, PipelineNode } from "~/server/app-layer/ops/types";
import type { StatusFilter } from "./types";

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

export function filterTree(
  nodes: PipelineNode[],
  query: string,
): PipelineNode[] | null {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();

  function prune(node: PipelineNode): PipelineNode | null {
    if (node.name.toLowerCase().includes(lower)) return node;
    const filtered = node.children
      .map(prune)
      .filter((c): c is PipelineNode => c !== null);
    if (filtered.length > 0) return { ...node, children: filtered };
    return null;
  }

  const result = nodes
    .map(prune)
    .filter((n): n is PipelineNode => n !== null);
  return result.length > 0 ? result : null;
}

export function isOverdue(ms: number | null): boolean {
  if (ms === null) return false;
  // Consider a group overdue if its oldest job is more than 5 minutes old
  return Date.now() - ms > 5 * 60 * 1000;
}

export function matchesStatusFilter(g: GroupInfo, filter: StatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "ok": return !g.isBlocked && !g.isStaleBlock;
    case "blocked": return g.isBlocked && !g.isStaleBlock;
    case "stale": return g.isStaleBlock;
    case "active": return g.hasActiveJob && !g.isBlocked;
  }
}
