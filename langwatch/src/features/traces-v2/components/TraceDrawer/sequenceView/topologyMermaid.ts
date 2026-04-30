import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { abbreviateModel, formatDuration } from "../../../utils/formatters";
import {
  buildSpanTree,
  sanitiseMermaidId,
  type SpanWithChildren,
} from "./_mermaidShared";
import type { SequenceSpanType } from "./types";

interface NodeInfo {
  id: string;
  display: string;
  kind: "agent" | "llm" | "tool" | "other";
}

interface EdgeInfo {
  fromId: string;
  toId: string;
  count: number;
  totalMs: number;
  hasError: boolean;
}

export interface TopologyMermaidResult {
  syntax: string;
  /** Sanitised node id → first matching span id, for click → select. */
  nodeToSpanId: Map<string, string>;
  /** Sanitised node id → display label rendered by Mermaid. */
  nodeDisplay: Map<string, string>;
  nodes: NodeInfo[];
  edgeCount: number;
}

function escapeNodeLabel(text: string): string {
  // Mermaid graph node labels can contain HTML entities — strip anything that
  // would confuse the parser, then cap length so wide labels don't blow up
  // the layout.
  const sanitised = text
    .replace(/[<>"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitised.length <= 36) return sanitised;
  return `${sanitised.slice(0, 33)}…`;
}

function getNode(span: SpanTreeNode): NodeInfo | null {
  const type = span.type ?? "span";
  if (type === "agent" && span.name) {
    const display = span.name
      .replace(".call", "")
      .replace(".run", "")
      .replace("invoke_agent ", "");
    return { id: sanitiseMermaidId(`agent_${display}`), display, kind: "agent" };
  }
  if (type === "llm" && span.model) {
    return {
      id: sanitiseMermaidId(`llm_${span.model}`),
      display: abbreviateModel(span.model),
      kind: "llm",
    };
  }
  if (type === "tool" && span.name) {
    return {
      id: sanitiseMermaidId(`tool_${span.name}`),
      display: span.name,
      kind: "tool",
    };
  }
  if (span.name) {
    return {
      id: sanitiseMermaidId(`other_${span.name}`),
      display: span.name,
      kind: "other",
    };
  }
  return null;
}

function nearestParentNode(
  span: SpanWithChildren,
  byId: Map<string, SpanWithChildren>,
  typesToInclude: ReadonlySet<string>,
): NodeInfo | null {
  let cursor = span.parentSpanId ? byId.get(span.parentSpanId) : null;
  while (cursor) {
    if (typesToInclude.has(cursor.type ?? "span")) {
      const node = getNode(cursor);
      if (node) return node;
    }
    cursor = cursor.parentSpanId ? byId.get(cursor.parentSpanId) : null;
  }
  return null;
}

// Palette mirrors the waterfall's SPAN_TYPE_COLORS / SPAN_TYPE_BADGE_STYLES.
// Mermaid's graph parser doesn't reliably accept CSS `var(...)` refs inside
// classDef, so we emit resolved hex per colour mode and let the surrounding
// effect re-render on theme change.
const LIGHT_PALETTE = {
  agent: { bg: "#F3E8FF", fg: "#6B21A8", stroke: "#A855F7" },
  llm: { bg: "#DBEAFE", fg: "#1D4ED8", stroke: "#3B82F6" },
  tool: { bg: "#D1FAE5", fg: "#047857", stroke: "#10B981" },
  other: { bg: "#F1F5F9", fg: "#334155", stroke: "#94A3B8" },
} as const;

const DARK_PALETTE = {
  agent: { bg: "#2E1065", fg: "#DDD6FE", stroke: "#A855F7" },
  llm: { bg: "#172554", fg: "#BFDBFE", stroke: "#3B82F6" },
  tool: { bg: "#022C22", fg: "#A7F3D0", stroke: "#10B981" },
  other: { bg: "#1E293B", fg: "#CBD5E1", stroke: "#64748B" },
} as const;

export function generateTopologySyntax(
  spans: SpanTreeNode[],
  includedTypes: readonly SequenceSpanType[],
  colorMode: "light" | "dark" = "light",
): TopologyMermaidResult {
  const tree = buildSpanTree(spans);
  const byId = new Map<string, SpanWithChildren>();
  for (const id in tree) {
    const node = tree[id];
    if (node) byId.set(id, node);
  }
  const typesToInclude = new Set<string>(includedTypes);

  const nodeMap = new Map<string, NodeInfo>();
  const nodeFirstSpan = new Map<string, string>();
  const edgeMap = new Map<string, EdgeInfo>();

  for (const span of spans) {
    const type = span.type ?? "span";
    if (!typesToInclude.has(type)) continue;
    const child = tree[span.spanId];
    if (!child) continue;
    const childNode = getNode(span);
    if (!childNode) continue;
    if (!nodeMap.has(childNode.id)) {
      nodeMap.set(childNode.id, childNode);
      nodeFirstSpan.set(childNode.id, span.spanId);
    }

    const parentNode = nearestParentNode(child, byId, typesToInclude);
    if (!parentNode || parentNode.id === childNode.id) continue;
    if (!nodeMap.has(parentNode.id)) {
      nodeMap.set(parentNode.id, parentNode);
      nodeFirstSpan.set(parentNode.id, child.parentSpanId ?? span.spanId);
    }

    const key = `${parentNode.id}->${childNode.id}`;
    const dur = Math.max(0, span.endTimeMs - span.startTimeMs);
    const isError = span.status === "error";
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalMs += dur;
      if (isError) existing.hasError = true;
    } else {
      edgeMap.set(key, {
        fromId: parentNode.id,
        toId: childNode.id,
        count: 1,
        totalMs: dur,
        hasError: isError,
      });
    }
  }

  const nodes = Array.from(nodeMap.values());
  const edges = Array.from(edgeMap.values()).sort((a, b) => b.count - a.count);

  const palette = colorMode === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  let syntax = "graph LR\n";
  for (const kind of ["agent", "llm", "tool", "other"] as const) {
    const c = palette[kind];
    syntax += `  classDef ${kind} fill:${c.bg},color:${c.fg},stroke:${c.stroke},stroke-width:1px\n`;
  }

  // All nodes use the rounded-rect shape — a single shape vocabulary reads
  // cleaner than mixing stadium/hexagon/rect. Kind is conveyed via fill.
  for (const node of nodes) {
    const label = escapeNodeLabel(node.display);
    syntax += `  ${node.id}("${label}"):::${node.kind}\n`;
  }

  for (const edge of edges) {
    const parts: string[] = [];
    if (edge.count > 1) parts.push(`×${edge.count}`);
    if (edge.totalMs > 0) parts.push(formatDuration(edge.totalMs));
    if (edge.hasError) parts.push("⚠");
    const label = parts.length > 0 ? parts.join(" · ") : "";
    const arrow = edge.hasError ? "==>" : "-->";
    syntax += label
      ? `  ${edge.fromId} ${arrow}|"${label}"| ${edge.toId}\n`
      : `  ${edge.fromId} ${arrow} ${edge.toId}\n`;
  }

  return {
    syntax,
    nodeToSpanId: nodeFirstSpan,
    nodeDisplay: new Map(nodes.map((n) => [n.id, n.display])),
    nodes,
    edgeCount: edges.length,
  };
}
