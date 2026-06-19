import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { formatDuration } from "../../../utils/formatters";
import type { BuiltTree, FlameNode, SpanContext, Viewport } from "./types";

export function buildTree(spans: SpanTreeNode[]): BuiltTree {
  const spanById = new Map<string, SpanTreeNode>();
  for (const s of spans) spanById.set(s.spanId, s);

  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  for (const s of spans) {
    const parentExists = s.parentSpanId ? spanById.has(s.parentSpanId) : false;
    const key = parentExists ? s.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(s);
    childrenMap.set(key, list);
  }

  const all: FlameNode[] = [];
  const byId = new Map<string, FlameNode>();
  let maxDepth = 0;

  function build(
    parentSpanId: string | null,
    parent: FlameNode | null,
    depth: number,
  ): FlameNode[] {
    const children = (childrenMap.get(parentSpanId) ?? [])
      .slice()
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
    return children.map((span) => {
      const node: FlameNode = {
        span,
        depth,
        parent,
        children: [],
        isOrphaned:
          span.parentSpanId !== null && !spanById.has(span.parentSpanId),
      };
      all.push(node);
      byId.set(span.spanId, node);
      if (depth > maxDepth) maxDepth = depth;
      node.children = build(span.spanId, node, depth + 1);
      return node;
    });
  }

  const roots = build(null, null, 0);
  return { roots, all, byId, maxDepth };
}

export function computeSpanContext(
  node: FlameNode,
  fullRange: Viewport,
): SpanContext {
  const dur = node.span.endTimeMs - node.span.startTimeMs;
  const parentDur = node.parent
    ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
    : null;
  const traceDur = fullRange.endMs - fullRange.startMs;
  return {
    duration: dur,
    parentName: node.parent?.span.name ?? null,
    parentDuration: parentDur,
    pctOfParent:
      parentDur !== null && parentDur > 0 ? (dur / parentDur) * 100 : null,
    pctOfTrace: traceDur > 0 ? (dur / traceDur) * 100 : null,
  };
}

export function formatPercent(pct: number): string {
  if (pct >= 99.95) return "100%";
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

// 1-2-5 nice-number step for smart tick spacing.
export function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const exp = Math.floor(Math.log10(roughStep));
  const f = roughStep / Math.pow(10, exp);
  let nice: number;
  if (f < 1.5) nice = 1;
  else if (f < 3.5) nice = 2;
  else if (f < 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

export function generateTicks(
  viewport: Viewport,
  fullStartMs: number,
  approxCount = 6,
): { time: number; label: string }[] {
  const duration = viewport.endMs - viewport.startMs;
  if (duration <= 0) return [];
  const step = niceStep(duration / approxCount);
  const first = Math.ceil(viewport.startMs / step) * step;
  const ticks: { time: number; label: string }[] = [];
  for (let t = first; t <= viewport.endMs + 1e-9; t += step) {
    ticks.push({ time: t, label: formatDuration(t - fullStartMs) });
  }
  return ticks;
}
