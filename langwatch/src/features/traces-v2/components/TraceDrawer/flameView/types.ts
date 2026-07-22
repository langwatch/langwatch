import type { SpanTreeNode } from "@langwatch/contracts/traces-v2";

export interface FlameViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
}

export interface FlameNode {
  span: SpanTreeNode;
  depth: number;
  parent: FlameNode | null;
  children: FlameNode[];
  isOrphaned: boolean;
}

export interface Viewport {
  startMs: number;
  endMs: number;
}

export interface BuiltTree {
  roots: FlameNode[];
  all: FlameNode[];
  byId: Map<string, FlameNode>;
  maxDepth: number;
}

export interface SpanContext {
  duration: number;
  parentName: string | null;
  parentDuration: number | null;
  pctOfParent: number | null;
  pctOfTrace: number | null;
}
