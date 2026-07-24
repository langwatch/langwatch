import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export type SequenceSubMode = "topology" | "sequence";

export interface SequenceViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  /**
   * Which diagram to draw. Set by the parent tab — `topology` shows the
   * who-talks-to-whom graph; `sequence` shows the chronological message
   * timeline. Each is a top-level visualisation tab of its own.
   */
  subMode: SequenceSubMode;
}

export const SEQUENCE_SPAN_TYPES = [
  "agent",
  "llm",
  "tool",
  "chain",
  "rag",
  "guardrail",
  "evaluation",
  "workflow",
  "component",
  "module",
  "server",
  "client",
  "producer",
  "consumer",
  "task",
  "span",
  "unknown",
] as const;

export type SequenceSpanType = (typeof SEQUENCE_SPAN_TYPES)[number];

export const DEFAULT_SEQUENCE_TYPES: SequenceSpanType[] = [
  "agent",
  "llm",
  "tool",
  "chain",
  "rag",
  "guardrail",
  "evaluation",
  "workflow",
];
