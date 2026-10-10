import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { AgentWithFields } from "./agent.ts";

/** One project. The list read names it and nothing else. */
const agentApiProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface AgentApiProjectInputSchema extends Named<
  typeof agentApiProjectInputSchemaDefinition
> {}
export const agentApiProjectInputSchema: AgentApiProjectInputSchema =
  agentApiProjectInputSchemaDefinition;

/** One agent inside one project, addressed by `id`. */
const agentApiAgentInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
});
export interface AgentApiAgentInputSchema extends Named<
  typeof agentApiAgentInputSchemaDefinition
> {}
export const agentApiAgentInputSchema: AgentApiAgentInputSchema =
  agentApiAgentInputSchemaDefinition;

/**
 * One agent inside one project, addressed by `agentId`. The same pair as
 * `agentApiAgentInputSchema` under the field name the copy-lineage procedures
 * have always published, which is why both spellings exist.
 */
const agentApiAgentReferenceInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string(),
});
export interface AgentApiAgentReferenceInputSchema extends Named<
  typeof agentApiAgentReferenceInputSchemaDefinition
> {}
export const agentApiAgentReferenceInputSchema: AgentApiAgentReferenceInputSchema =
  agentApiAgentReferenceInputSchemaDefinition;

/** One turn to an agent: the Test panel of the agent drawers. */
const agentApiTestTurnInputSchemaDefinition = z.object({
  ...agentApiAgentInputSchema.shape,
  message: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export interface AgentApiTestTurnInputSchema extends Named<
  typeof agentApiTestTurnInputSchemaDefinition
> {}
export const agentApiTestTurnInputSchema: AgentApiTestTurnInputSchema =
  agentApiTestTurnInputSchemaDefinition;

const agentApiPushToCopiesInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string(),
  copyIds: z.array(z.string()).optional(),
});
export interface AgentApiPushToCopiesInputSchema extends Named<
  typeof agentApiPushToCopiesInputSchemaDefinition
> {}
export const agentApiPushToCopiesInputSchema: AgentApiPushToCopiesInputSchema =
  agentApiPushToCopiesInputSchemaDefinition;

const agentApiCopyRequestSchemaDefinition = z.object({
  agentId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  newAgentId: z.string().optional(),
});
export interface AgentApiCopyRequestSchema extends Named<
  typeof agentApiCopyRequestSchemaDefinition
> {}
export const agentApiCopyRequestSchema: AgentApiCopyRequestSchema =
  agentApiCopyRequestSchemaDefinition;

export type AgentApiCopyRequest = z.infer<typeof agentApiCopyRequestSchema>;
export type AgentApiProjectInput = z.infer<typeof agentApiProjectInputSchema>;
export type AgentApiAgentInput = z.infer<typeof agentApiAgentInputSchema>;
export type AgentApiAgentReferenceInput = z.infer<typeof agentApiAgentReferenceInputSchema>;
export type AgentApiTestTurnInput = z.infer<typeof agentApiTestTurnInputSchema>;
export type AgentApiPushToCopiesInput = z.infer<typeof agentApiPushToCopiesInputSchema>;

export type AgentApiUpdateOutput = AgentWithFields;
