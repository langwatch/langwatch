import { z } from "zod";
import type { AgentWithFields } from "./agent.ts";

/** One project. The list read names it and nothing else. */
export const agentApiProjectInputSchema = z.object({ projectId: z.string() });

/** One agent inside one project, addressed by `id`. */
export const agentApiAgentInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

/**
 * One agent inside one project, addressed by `agentId`. The same pair as
 * `agentApiAgentInputSchema` under the field name the copy-lineage procedures
 * have always published, which is why both spellings exist.
 */
export const agentApiAgentReferenceInputSchema = z.object({
  projectId: z.string(),
  agentId: z.string(),
});

/** One turn to an agent: the Test panel of the agent drawers. */
export const agentApiTestTurnInputSchema = z.object({
  ...agentApiAgentInputSchema.shape,
  message: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const agentApiPushToCopiesInputSchema = z.object({
  projectId: z.string(),
  agentId: z.string(),
  copyIds: z.array(z.string()).optional(),
});

export const agentApiCopyRequestSchema = z.object({
  agentId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  newAgentId: z.string().optional(),
});

export type AgentApiCopyRequest = z.infer<typeof agentApiCopyRequestSchema>;
export type AgentApiProjectInput = z.infer<typeof agentApiProjectInputSchema>;
export type AgentApiAgentInput = z.infer<typeof agentApiAgentInputSchema>;
export type AgentApiAgentReferenceInput = z.infer<typeof agentApiAgentReferenceInputSchema>;
export type AgentApiTestTurnInput = z.infer<typeof agentApiTestTurnInputSchema>;
export type AgentApiPushToCopiesInput = z.infer<typeof agentApiPushToCopiesInputSchema>;

export type AgentApiUpdateOutput = AgentWithFields;
