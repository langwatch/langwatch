/** Trace UI that reads trace's own data, lent by token to the modules that show it (§10, §10.1). */

/** What a screen hands trace's input/output viewer. */
export type RenderInputOutputProps = {
  value: unknown;
  showTools?: boolean | "copy-only";
  collapsed?: boolean;
  collapseStringsAfterLength?: number;
  /** Per-node collapse decision, e.g. "start every array collapsed". */
  shouldCollapse?: (field: { type: string }) => boolean;
  /** Show the entry count beside each object and array. */
  displayObjectSize?: boolean;
};

/** What a screen hands trace's eye-icon peek at one trace. */
export type TraceIdPeekProps = {
  traceId: string;
};

/** What an empty state hands trace's "Setup via Agent" menu. */
export type SetupWithAgentButtonProps = {
  surface: "simulations" | "simulationRuns" | "connectedAgents" | "prompts" | "evaluators";
  size?: "sm" | "md";
};

/** What annotation's queue walker hands the conversation trace lends it. */
export type AnnotationQueueConversationProps = {
  /** The trace the queue item names; its turn is the one under review. */
  traceId: string;
  /** The thread that trace belongs to, or null for a trace in no thread. */
  conversationId: string | null;
};

/** What a screen hands trace's way into correcting one trace. */
export type TraceEditButtonProps = {
  traceId: string;
  /** When the trace started, so the drawer reads its partition; null when unknown. */
  occurredAtMs: number | null;
  disabled?: boolean;
};
