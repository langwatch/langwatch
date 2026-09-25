// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The served `governanceAgents.*` procedures, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { agentsListingOutcomeSchema } from "./agents-listing.ts";

const organizationScope = z.object({ organizationId: z.string() });

export const agentSyncSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceType: z.string(),
});
export type AgentSyncSource = z.infer<typeof agentSyncSourceSchema>;

export const agentSyncSourceListingSchema = z.object({
  ...agentSyncSourceSchema.shape,
  lastListing: agentsListingOutcomeSchema.nullable(),
});
export type AgentSyncSourceListing = z.infer<typeof agentSyncSourceListingSchema>;

export const agentListingRequestResultSchema = z.object({
  requested: z.number().int().nonnegative(),
  sources: agentSyncSourceSchema.array(),
});
export type AgentListingRequestResult = z.infer<typeof agentListingRequestResultSchema>;

/** Where an agent came to us from: the chips the source filter offers. */
export const AGENT_SOURCES = ["custom", "databricks", "copilot_studio"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/** Stored, never derived from the clock: "erroring" cannot be read off last activity. */
export const AGENT_HEALTH_STATES = ["responding", "idle", "erroring"] as const;
export type AgentHealth = (typeof AGENT_HEALTH_STATES)[number];

/** One Agents-page row; a null figure is unmeasured, never zero (specs/ai-governance/dashboard/agents-page.feature). */
export const governanceAgentRowSchema = z.object({
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
