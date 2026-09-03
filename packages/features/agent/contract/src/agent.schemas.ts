/**
 * The inputs the `agents.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * The two schemas that mint an identifier take the generator as a parameter.
 * This package depends on zod and nothing else on purpose, and which id scheme
 * a deployment uses is the process's decision rather than the contract's.
 */
import { z } from "zod";
import { createAgentCommandSchema } from "./agent.commands";
import type { AgentWithFields } from "./agent";

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
export const agentApiTestTurnInputSchema = agentApiAgentInputSchema.extend({
  message: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const agentApiPushToCopiesInputSchema = z.object({
  projectId: z.string(),
  agentId: z.string(),
  copyIds: z.array(z.string()).optional(),
});

/** Creating an agent. `generateAgentId` supplies an id the caller omitted. */
export function agentApiCreateInputSchema(generateAgentId: () => string) {
  return createAgentCommandSchema.transform((input) => ({
    ...input,
    id: input.id ?? generateAgentId(),
  }));
}

/** Copying an agent between projects. `generateAgentId` names the copy. */
export function agentApiCopyInputSchema(generateAgentId: () => string) {
  return z.object({
    agentId: z.string(),
    projectId: z.string(),
    sourceProjectId: z.string(),
    newAgentId: z.string().default(generateAgentId),
  });
}

export type AgentApiProjectInput = z.infer<typeof agentApiProjectInputSchema>;
export type AgentApiAgentInput = z.infer<typeof agentApiAgentInputSchema>;
export type AgentApiAgentReferenceInput = z.infer<typeof agentApiAgentReferenceInputSchema>;
export type AgentApiTestTurnInput = z.infer<typeof agentApiTestTurnInputSchema>;
export type AgentApiPushToCopiesInput = z.infer<typeof agentApiPushToCopiesInputSchema>;

/**
 * What the write the studio borrows answers.
 *
 * `AgentWithFields` is this contract's own zod-inferred shape and
 * {@link AgentService} declares exactly this return, so stating it restates
 * nothing and leaks no Prisma row. `update` is the one of the three `agents.*`
 * procedures the studio calls that hands the application's answer straight
 * back — `getAll` and `getById` are reshaped by the transport, which is why
 * only this one is stated here.
 */
export type AgentApiUpdateOutput = AgentWithFields;
