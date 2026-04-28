import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import {
  type FlatRow,
  SIBLING_GROUP_THRESHOLD,
  type SiblingGroup,
  type WaterfallTreeNode,
} from "./types";

export function buildTree(spans: SpanTreeNode[]): WaterfallTreeNode[] {
  const byId = new Map<string, SpanTreeNode>();
  for (const span of spans) {
    byId.set(span.spanId, span);
  }

  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  for (const span of spans) {
    // Determine if this span's parent exists in the trace
    const parentExists = span.parentSpanId ? byId.has(span.parentSpanId) : true;
    const key = parentExists ? span.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(span);
    childrenMap.set(key, list);
  }

  function buildNodes(
    parentId: string | null,
    depth: number,
  ): WaterfallTreeNode[] {
    const children = childrenMap.get(parentId) ?? [];
    const sorted = [...children].sort((a, b) => a.startTimeMs - b.startTimeMs);
    return sorted.map((span) => {
      const isOrphaned =
        span.parentSpanId !== null && !byId.has(span.parentSpanId);
      return {
        span,
        children: buildNodes(span.spanId, depth + 1),
        depth,
        isOrphaned,
      };
    });
  }

  return buildNodes(null, 0);
}

export function groupSiblings(
  children: WaterfallTreeNode[],
): (WaterfallTreeNode | SiblingGroup)[] {
  if (children.length <= SIBLING_GROUP_THRESHOLD) return children;

  const nameGroups = new Map<string, WaterfallTreeNode[]>();
  const order: string[] = [];
  for (const child of children) {
    const key = `${child.span.name}::${child.span.type ?? "span"}`;
    if (!nameGroups.has(key)) {
      nameGroups.set(key, []);
      order.push(key);
    }
    nameGroups.get(key)!.push(child);
  }

  const result: (WaterfallTreeNode | SiblingGroup)[] = [];
  for (const key of order) {
    const group = nameGroups.get(key)!;
    if (group.length > SIBLING_GROUP_THRESHOLD) {
      const spans = group.map((n) => n.span);
      const durations = spans.map((s) => s.durationMs);
      const errorCount = spans.filter((s) => s.status === "error").length;
      result.push({
        kind: "group",
        name: group[0]!.span.name,
        type: group[0]!.span.type ?? "span",
        count: group.length,
        spans,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        errorCount,
        minStart: Math.min(...spans.map((s) => s.startTimeMs)),
        maxEnd: Math.max(...spans.map((s) => s.endTimeMs)),
        depth: group[0]!.depth,
        parentSpanId: group[0]!.span.parentSpanId,
      });
    } else {
      result.push(...group);
    }
  }
  return result;
}

export function flattenTree(
  nodes: WaterfallTreeNode[],
  collapsedIds: Set<string>,
  expandedGroups: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  function walk(nodeList: WaterfallTreeNode[]) {
    // Group siblings at this level
    const items = groupSiblings(nodeList);

    for (const item of items) {
      if ("kind" in item && item.kind === "group") {
        const groupKey = `${item.parentSpanId}::${item.name}`;
        result.push(item);
        if (expandedGroups.has(groupKey)) {
          for (const span of item.spans) {
            const fakeNode: WaterfallTreeNode = {
              span,
              children: [],
              depth: item.depth,
              isOrphaned: false,
            };
            result.push({ kind: "span", node: fakeNode });
          }
        }
      } else {
        const node = item as WaterfallTreeNode;
        result.push({ kind: "span", node });
        if (!collapsedIds.has(node.span.spanId) && node.children.length > 0) {
          walk(node.children);
        }
      }
    }
  }

  walk(nodes);
  return result;
}

export function getTraceRange(spans: SpanTreeNode[]): {
  rootStart: number;
  rootEnd: number;
  rootDuration: number;
} {
  if (spans.length === 0) {
    return { rootStart: 0, rootEnd: 0, rootDuration: 0 };
  }
  const rootStart = Math.min(...spans.map((s) => s.startTimeMs));
  const rootEnd = Math.max(...spans.map((s) => s.endTimeMs));
  return {
    rootStart,
    rootEnd,
    rootDuration: rootEnd - rootStart,
  };
}

export function getTimeMarkers(duration: number): number[] {
  if (duration <= 0) return [0];
  const count = 5;
  return Array.from({ length: count + 1 }, (_, i) => (i / count) * duration);
}
