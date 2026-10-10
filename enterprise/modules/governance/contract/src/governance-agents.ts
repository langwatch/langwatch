// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The served `governanceAgents.*` procedures, declared once, at main's wire names. */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

export const agentsListingRefusalCauseSchema = z.enum(["access", "unreachable", "incomplete"]);
export type AgentsListingRefusalCause = z.infer<typeof agentsListingRefusalCauseSchema>;

const agentsListingOutcomeSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("listed") }),
  z.object({ outcome: z.literal("refused"), cause: agentsListingRefusalCauseSchema }),
]);
export interface AgentsListingOutcomeSchema extends Named<
  typeof agentsListingOutcomeSchemaDefinition
> {}
export const agentsListingOutcomeSchema: AgentsListingOutcomeSchema =
  agentsListingOutcomeSchemaDefinition;
export type AgentsListingOutcome = z.infer<typeof agentsListingOutcomeSchema>;

const organizationScope = z.object({ organizationId: z.string() });

const agentSyncSourceSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  sourceType: z.string(),
});
export interface AgentSyncSourceSchema extends Named<typeof agentSyncSourceSchemaDefinition> {}
export const agentSyncSourceSchema: AgentSyncSourceSchema = agentSyncSourceSchemaDefinition;
export type AgentSyncSource = z.infer<typeof agentSyncSourceSchema>;

const agentSyncSourceListingSchemaDefinition = z.object({
  ...agentSyncSourceSchema.shape,
  lastListing: agentsListingOutcomeSchema.nullable(),
});
export interface AgentSyncSourceListingSchema extends Named<
  typeof agentSyncSourceListingSchemaDefinition
> {}
export const agentSyncSourceListingSchema: AgentSyncSourceListingSchema =
  agentSyncSourceListingSchemaDefinition;
export type AgentSyncSourceListing = z.infer<typeof agentSyncSourceListingSchema>;

const agentListingRequestResultSchemaDefinition = z.object({
  requested: z.number().int().nonnegative(),
  sources: agentSyncSourceSchema.array(),
});
export interface AgentListingRequestResultSchema extends Named<
  typeof agentListingRequestResultSchemaDefinition
> {}
export const agentListingRequestResultSchema: AgentListingRequestResultSchema =
  agentListingRequestResultSchemaDefinition;
export type AgentListingRequestResult = z.infer<typeof agentListingRequestResultSchema>;

/** Where an agent came to us from: the chips the source filter offers. */
export const AGENT_SOURCES = ["custom", "databricks", "copilot_studio"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/** Stored, never derived from the clock: "erroring" cannot be read off last activity. */
export const AGENT_HEALTH_STATES = ["responding", "idle", "erroring"] as const;
export type AgentHealth = (typeof AGENT_HEALTH_STATES)[number];

/** One Agents-page row; a null figure is unmeasured, never zero (specs/ai-governance/dashboard/agents-page.feature). */
const governanceAgentRowSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  environment: z.string().nullable(),
  owner: z.string().nullable(),
  models: z.string().array(),
  source: z.enum(AGENT_SOURCES),
  costUsd30d: z.number().nullable(),
  requests30d: z.number().nullable(),
  lastActiveMinutesAgo: z.number().nullable(),
  health: z.enum(AGENT_HEALTH_STATES).nullable(),
  registeredDaysAgo: z.number().nullable(),
});
export interface GovernanceAgentRowSchema extends Named<
  typeof governanceAgentRowSchemaDefinition
> {}
export const governanceAgentRowSchema: GovernanceAgentRowSchema =
  governanceAgentRowSchemaDefinition;
export type GovernanceAgentRow = z.infer<typeof governanceAgentRowSchema>;

export const governanceAgentsTrpc = defineTrpcContract("governanceAgents")
  .query("list")
  .withInput(organizationScope)
  .withOutput(governanceAgentRowSchema.array())

  .query("syncSources")
  .withInput(organizationScope)
  .withOutput(agentSyncSourceListingSchema.array())

  .mutation("requestListing")
  .withInput(organizationScope)
  .withOutput(agentListingRequestResultSchema)
  .build();
