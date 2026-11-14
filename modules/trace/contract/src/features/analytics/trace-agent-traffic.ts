import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One agent a project's spans named in `gen_ai.agent.name` over a window. */
const traceAgentSeenSchemaDefinition = z.object({
  agentName: z.string().min(1),
  /** The non-empty `gen_ai.agent.id` on most of its spans, ties broken by value. */
  agentId: z.string().nullable(),
  /** The non-empty `gen_ai.request.model` on most of its spans, ties broken by value. */
  model: z.string().nullable(),
  /** Spans in the window; an ordering signal, unmerged duplicates may count twice. */
  spanCount: z.number().int().nonnegative(),
  firstSeenMs: z.number().int(),
  lastSeenMs: z.number().int(),
});
export interface TraceAgentSeenSchema extends Named<typeof traceAgentSeenSchemaDefinition> {}
export const traceAgentSeenSchema: TraceAgentSeenSchema = traceAgentSeenSchemaDefinition;
export type TraceAgentSeen = z.infer<typeof traceAgentSeenSchema>;
