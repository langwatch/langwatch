import type { ReactNode } from "react";

export type TraceFlameSpan = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  type: string | null;
  startTimeMs: number;
  endTimeMs: number;
  status: "ok" | "error" | "unset";
  model: string | null;
};

export interface FlameViewProps {
  spans: TraceFlameSpan[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  renderShortcutKey: (label: string) => ReactNode;
}

export interface FlameNode {
  span: TraceFlameSpan;
  depth: number;
  parent: FlameNode | null;
  children: FlameNode[];
  isOrphaned: boolean;
}

export interface Viewport {
  startMs: number;
  endMs: number;
}

export interface FlameTick {
  time: number;
  label: string;
}

export interface FlameRelatedSpanIds {
  ancestors: Set<string>;
  descendants: Set<string>;
  parent: FlameNode | null;
  children: Set<string>;
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
