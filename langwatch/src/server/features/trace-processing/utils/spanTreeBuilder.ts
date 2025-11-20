import type { SpanEvent } from "../types";

/**
 * Represents a node in the span tree.
 */
export interface SpanTreeNode {
  span: SpanEvent;
  children: SpanTreeNode[];
}

/**
 * Builds a tree structure from span events.
 * Spans without parents are placed at the root level.
 */
export function buildSpanTree(events: readonly SpanEvent[]): SpanTreeNode[] {
  const spanMap = new Map<string, SpanTreeNode>();
  const rootNodes: SpanTreeNode[] = [];

  // Create nodes for all spans
  for (const event of events) {
    const node: SpanTreeNode = {
      span: event,
      children: [],
    };
    spanMap.set(event.data.spanId, node);
  }

  // Build the tree
  for (const event of events) {
    const node = spanMap.get(event.data.spanId)!;

    if (event.data.parentSpanId) {
      // Try to find parent
      const parentNode = spanMap.get(event.data.parentSpanId);
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
