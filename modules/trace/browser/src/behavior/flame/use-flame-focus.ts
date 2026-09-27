import { useMemo } from "react";

import { ancestorChain, computeSpanContext, relatedSpanIdsOf } from "./tree.ts";
import type { BuiltTree, FlameNode, Viewport } from "./types.ts";

/**
 * What the flame graph is about right now: the breadcrumb trail of the focused
 * or selected span, and the context span (hover over focus over selection)
 * with its timing and relatives.
 */
export function useFlameFocus({
  tree,
  fullRange,
  hoveredSpanId,
  focusedSpanId,
  selectedSpanId,
}: {
  tree: BuiltTree;
  fullRange: Viewport;
  hoveredSpanId: string | null;
  focusedSpanId: string | null;
  selectedSpanId: string | null;
}) {
  const trailId = focusedSpanId ?? selectedSpanId;
  const breadcrumbs = useMemo(
    () => (trailId ? ancestorChain(tree.byId.get(trailId)) : []),
    [trailId, tree.byId],
  );
  const contextId = hoveredSpanId ?? trailId;
  const contextNode = useMemo<FlameNode | null>(
    () => (contextId ? (tree.byId.get(contextId) ?? null) : null),
    [contextId, tree.byId],
  );
  const contextInfo = useMemo(
    () => (contextNode ? computeSpanContext(contextNode, fullRange) : null),
    [contextNode, fullRange],
  );
  const relatedSpanIds = useMemo(
    () => (contextNode ? relatedSpanIdsOf(contextNode) : null),
    [contextNode],
  );
  return { breadcrumbs, contextNode, contextInfo, relatedSpanIds };
}
