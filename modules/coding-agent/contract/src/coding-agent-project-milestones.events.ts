import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A stored session, recorded by coding-agent; peers react from their side (§9). */
export const CODING_AGENT_SESSION_STORED_EVENT_TYPE = "lw.coding_agent.session_stored" as const;

const codingAgentSessionStoredEventDataSchemaDefinition = z
  .object({
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    /** The product id (`claude_code`, `codex`), not a sub-agent type. */
    agentType: z.string().min(1),
    /** True only for the project's first session; the owner decides it, never a peer. */
    firstForProject: z.boolean(),
    /** The session's own last event time, epoch ms, never more than a day after it was recorded. */
    occurredAt: z.number().int().nonnegative(),
  })
  .strict();
export interface CodingAgentSessionStoredEventDataSchema extends Named<
  typeof codingAgentSessionStoredEventDataSchemaDefinition
> {}
export const codingAgentSessionStoredEventDataSchema: CodingAgentSessionStoredEventDataSchema =
  codingAgentSessionStoredEventDataSchemaDefinition;
export type CodingAgentSessionStoredEventData = z.infer<
  typeof codingAgentSessionStoredEventDataSchema
>;
