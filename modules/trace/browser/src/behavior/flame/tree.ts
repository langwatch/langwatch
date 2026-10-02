import { formatDuration } from "@langwatch/design-system/display-formatters";

import { ZOOM_FIT_PADDING } from "../../model/flame/constants.ts";
import type {
  BuiltTree,
  FlameNode,
  FlameRelatedSpanIds,
  SpanContext,
  TraceFlameSpan,
  Viewport,
} from "./types.ts";

export function buildTree(spans: TraceFlameSpan[]): BuiltTree {
  const spanById = new Map<string, TraceFlameSpan>();
  for (const s of spans) spanById.set(s.spanId, s);

  const childrenMap = new Map<string | null, TraceFlameSpan[]>();
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
      .toSorted((a, b) => a.startTimeMs - b.startTimeMs);
    return children.map((span) => {
      const node: FlameNode = {
        span,
        depth,
        parent,
        children: [],
        isOrphaned: span.parentSpanId !== null && !spanById.has(span.parentSpanId),
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

export function computeSpanContext(node: FlameNode, fullRange: Viewport): SpanContext {
  const dur = node.span.endTimeMs - node.span.startTimeMs;
  const parentDur = node.parent ? node.parent.span.endTimeMs - node.parent.span.startTimeMs : null;
  const traceDur = fullRange.endMs - fullRange.startMs;
  return {
    duration: dur,
    parentName: node.parent?.span.name ?? null,
    parentDuration: parentDur,
    pctOfParent: parentDur !== null && parentDur > 0 ? (dur / parentDur) * 100 : null,
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
function niceStep(roughStep: number): number {
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

/** The time the spans cover, first start to last end. */
export function fullRangeOf(spans: TraceFlameSpan[]): Viewport {
  if (spans.length === 0) return { startMs: 0, endMs: 0 };
  return spans.reduce<Viewport>(
    (range, s) => ({
      startMs: Math.min(range.startMs, s.startTimeMs),
      endMs: Math.max(range.endMs, s.endTimeMs),
    }),
    { startMs: Infinity, endMs: -Infinity },
  );
}

/** The viewport that fits one span with padding either side. */
export function fitViewport(node: FlameNode): Viewport {
  const pad = Math.max((node.span.endTimeMs - node.span.startTimeMs) * ZOOM_FIT_PADDING, 0);
  return { startMs: node.span.startTimeMs - pad, endMs: node.span.endTimeMs + pad };
}

/**
 * Where the viewport goes to bring a span that fell wholly outside it back into
 * view: centred at the same zoom when the span is small, fitted otherwise.
 */
export function followViewport({
  node,
  viewport,
}: {
  node: FlameNode;
  viewport: Viewport;
}): Viewport | undefined {
  const { startTimeMs, endTimeMs } = node.span;
  if (endTimeMs >= viewport.startMs && startTimeMs <= viewport.endMs) return undefined;
  const viewportDur = viewport.endMs - viewport.startMs;
  if (endTimeMs - startTimeMs >= viewportDur * 0.5) return fitViewport(node);
  const center = (startTimeMs + endTimeMs) / 2;
  return { startMs: center - viewportDur / 2, endMs: center + viewportDur / 2 };
}

/** A node and its ancestors, root first. */
export function ancestorChain(node: FlameNode | undefined): FlameNode[] {
  const chain: FlameNode[] = [];
  for (let curr: FlameNode | null = node ?? null; curr; curr = curr.parent) chain.unshift(curr);
  return chain;
}

function descendantIdsOf(node: FlameNode): string[] {
  return node.children.flatMap((child) => [child.span.spanId, ...descendantIdsOf(child)]);
}

/** The ancestors and descendants of a span, which drive the relationship highlights. */
export function relatedSpanIdsOf(node: FlameNode): FlameRelatedSpanIds {
  return {
    ancestors: new Set(ancestorChain(node.parent ?? undefined).map((n) => n.span.spanId)),
    descendants: new Set(descendantIdsOf(node)),
    parent: node.parent,
    children: new Set(node.children.map((child) => child.span.spanId)),
  };
}

/** The nodes a viewport shows, or all of them when it has no width. */
export function nodesInViewport({
  nodes,
  viewport,
}: {
  nodes: FlameNode[];
  viewport: Viewport;
}): FlameNode[] {
  if (viewport.endMs - viewport.startMs <= 0) return nodes;
  return nodes.filter(
    (n) => n.span.endTimeMs >= viewport.startMs && n.span.startTimeMs <= viewport.endMs,
  );
}

/** Nodes grouped by depth, so each virtual row reads only its own. */
export function groupByDepth(nodes: FlameNode[]): Map<number, FlameNode[]> {
  const map = new Map<number, FlameNode[]>();
  for (const node of nodes) {
    const row = map.get(node.depth);
    if (row) row.push(node);
    else map.set(node.depth, [node]);
  }
  return map;
}

/** How many visible spans are too narrow to draw, counted only once the view is crowded. */
export function hiddenSpanCountOf({
  nodes,
  durationMs,
}: {
  nodes: FlameNode[];
  durationMs: number;
}): number {
  if (nodes.length <= 200) return 0;
  return nodes.filter(
    (node) => ((node.span.endTimeMs - node.span.startTimeMs) / durationMs) * 100 < 0.1,
  ).length;
}

/**
 * Whether a click landed on the flame area's empty space: the area itself or
 * its absolute layer. A span's own click stops propagation before this.
 */
export function isEmptyFlameClick({
  target,
  currentTarget,
}: {
  target: EventTarget;
  currentTarget: EventTarget;
}): boolean {
  if (target === currentTarget) return true;
  return target instanceof HTMLElement && target.dataset.flameLayer === "true";
}
