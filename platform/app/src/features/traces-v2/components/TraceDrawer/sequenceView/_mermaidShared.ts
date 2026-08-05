import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export interface SpanWithChildren extends SpanTreeNode {
  children: SpanWithChildren[];
}

/**
 * Builds a parent → children adjacency map keyed by spanId. Walks `spans`
 * twice: first to seed every node, then to attach children to their
 * parent. Orphans (parent missing from the input set) stay as roots.
 */
export function buildSpanTree(
  spans: SpanTreeNode[],
): Record<string, SpanWithChildren> {
  const lookup: Record<string, SpanWithChildren> = {};
  for (const span of spans) {
    lookup[span.spanId] = { ...span, children: [] };
  }
  for (const span of spans) {
    const node = lookup[span.spanId];
    if (!node) continue;
    if (span.parentSpanId && lookup[span.parentSpanId]) {
      lookup[span.parentSpanId]!.children.push(node);
    }
  }
  return lookup;
}

/**
 * Coerces an arbitrary string into a Mermaid-safe identifier. Strips
 * everything outside `[A-Za-z0-9]` to underscores, trims leading/trailing
 * underscores, and prefixes a leading digit with `n_` so the result is a
 * valid Mermaid node id.
 */
export function sanitiseMermaidId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "node";
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}
