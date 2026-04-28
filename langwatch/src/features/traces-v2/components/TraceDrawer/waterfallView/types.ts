import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export interface WaterfallViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
}

export interface WaterfallTreeNode {
  span: SpanTreeNode;
  children: WaterfallTreeNode[];
  depth: number;
  isOrphaned: boolean;
}

export interface SiblingGroup {
  kind: "group";
  name: string;
  type: string;
  count: number;
  spans: SpanTreeNode[];
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errorCount: number;
  minStart: number;
  maxEnd: number;
  depth: number;
  parentSpanId: string | null;
}

export type FlatRow = { kind: "span"; node: WaterfallTreeNode } | SiblingGroup;

export const ROW_HEIGHT = 28;
export const LLM_ROW_HEIGHT = 40;
export const GROUP_ROW_HEIGHT = 36;
export const INDENT_PX = 20;
export const MIN_TREE_WIDTH = 200;
export const DEFAULT_TREE_PCT = 0.38;
export const MIN_BAR_PX = 3;
export const BAR_HEIGHT = 14;
export const SIBLING_GROUP_THRESHOLD = 5;

export const SPAN_TYPE_ICONS: Record<string, string> = {
  llm: "◈",
  tool: "⚙",
  agent: "◎",
  rag: "⊛",
  guardrail: "◉",
  evaluation: "◇",
  chain: "○",
  span: "○",
  module: "○",
  workflow: "○",
};
