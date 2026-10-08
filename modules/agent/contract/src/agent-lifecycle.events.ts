import { z } from "zod";

/** Workflow archives the agent's graph from its own side on this fact (§9, plan §7). */
export const AGENT_ARCHIVED_EVENT_TYPE = "lw.agent.archived" as const;

/** An agent was archived, and the linked graph the archive cascades to, if any. */
export const agentArchivedEventDataSchema = z.object({
  agentId: z.string(),
  projectId: z.string(),
  cascadedWorkflowId: z.string().nullable(),
  occurredAt: z.number().int().nonnegative(),
});
export type AgentArchivedEventData = z.infer<typeof agentArchivedEventDataSchema>;
