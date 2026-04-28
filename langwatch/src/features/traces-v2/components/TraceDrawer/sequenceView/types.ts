import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export interface SequenceViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
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
