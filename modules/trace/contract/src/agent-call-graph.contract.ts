import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One agent in a trace: a `gen_ai.agent.name` or id, else the span's `service.name`. */
const agentCallGraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["agent", "service", "unknown"]),
  spanCount: z.number(),
  llmSpanCount: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  /** Null when no LLM span of this agent carries a cost. */
  cost: z.number().nullable(),
  /** True when the agent's first span names a parent that is not in the trace. */
  hasMissingParent: z.boolean(),
});

/** Calls from one agent to another, counted at the span where the agent changes. */
const agentCallGraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  callCount: z.number(),
  errorCount: z.number(),
  totalDurationMs: z.number(),
  maxDurationMs: z.number(),
  /** True when at least one of the calls is an A2A span. */
  a2a: z.boolean(),
  spanIds: z.array(z.string()),
});

/** A span recognised as an A2A call, so the span tree can label it. */
const a2aSpanMarkSchema = z.object({
  spanId: z.string(),
  role: z.enum(["client", "server", "unknown"]),
  method: z.string().nullable(),
  contextId: z.string().nullable(),
  taskId: z.string().nullable(),
  taskState: z.string().nullable(),
});

const agentCallGraphSchemaDefinition = z.object({
  nodes: z.array(agentCallGraphNodeSchema),
  edges: z.array(agentCallGraphEdgeSchema),
  a2aSpans: z.array(a2aSpanMarkSchema),
});
export interface AgentCallGraphSchema extends Named<typeof agentCallGraphSchemaDefinition> {}
export const agentCallGraphSchema: AgentCallGraphSchema = agentCallGraphSchemaDefinition;

export type AgentCallGraph = z.infer<typeof agentCallGraphSchema>;
export type AgentCallGraphNode = z.infer<typeof agentCallGraphNodeSchema>;
export type AgentCallGraphEdge = z.infer<typeof agentCallGraphEdgeSchema>;
export type A2aSpanMark = z.infer<typeof a2aSpanMarkSchema>;
