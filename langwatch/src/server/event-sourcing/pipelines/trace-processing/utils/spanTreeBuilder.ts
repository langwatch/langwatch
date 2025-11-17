import type { SpanData } from "../types";

/**
 * Represents a node in the span tree.
 */
export interface SpanTreeNode {
  span: SpanData;
  children: SpanTreeNode[];
}

/**
 * Builds a tree structure from span data.
 * Spans without parents are placed at the root level.
 */
export function buildSpanTree(spans: readonly SpanData[]): SpanTreeNode[] {
  const spanMap = new Map<string, SpanTreeNode>();
  const rootNodes: SpanTreeNode[] = [];

  // Create nodes for all spans
  for (const span of spans) {
    const node: SpanTreeNode = {
      span,
      children: [],
    };
    spanMap.set(span.spanId, node);
  }

  // Build the tree
  for (const span of spans) {
    const node = spanMap.get(span.spanId)!;

    if (span.parentSpanId) {
      // Try to find parent
      const parentNode = spanMap.get(span.parentSpanId);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        // Parent not found, put at root
        rootNodes.push(node);
      }
    } else {
      // No parent, put at root
      rootNodes.push(node);
    }
  }

  return rootNodes;
}

export const SpanTreeBuilder = {
  buildSpanTree,
} as const;
