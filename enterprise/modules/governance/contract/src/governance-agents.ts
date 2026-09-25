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

export const governanceAgentsTrpc = defineTrpcContract("governanceAgents")
  .query("syncSources")
  .withInput(organizationScope)
  .withOutput(agentSyncSourceListingSchema.array())

  .mutation("requestListing")
  .withInput(organizationScope)
  .withOutput(agentListingRequestResultSchema)
  .build();
