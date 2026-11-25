// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organisation's registry settings: how many days without traffic make a listed agent
 * dormant. Read under `governance:view`, saved under `ingestionSources:manage`, over REST
 * (`/api/governance/registry/settings`) and tRPC (`governanceRegistry.*`).
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

export const AGENT_REGISTRY_DORMANT_AFTER_DAYS_DEFAULT = 30;
export const AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN = 1;
export const AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX = 365;

const dormantAfterDays = z
  .number()
  .int()
  .min(AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN)
  .max(AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX);

const agentRegistrySettingsSchemaDefinition = z.object({
  /** Days without a trace after which a listed agent reads as dormant. */
  dormant_after_days: dormantAfterDays,
});
export interface AgentRegistrySettingsSchema extends Named<
  typeof agentRegistrySettingsSchemaDefinition
> {}
export const agentRegistrySettingsSchema: AgentRegistrySettingsSchema =
  agentRegistrySettingsSchemaDefinition;
export type AgentRegistrySettings = z.infer<typeof agentRegistrySettingsSchema>;

const agentRegistrySettingsResponseSchemaDefinition = z.object({
  data: agentRegistrySettingsSchema,
});
export interface AgentRegistrySettingsResponseSchema extends Named<
  typeof agentRegistrySettingsResponseSchemaDefinition
> {}
export const agentRegistrySettingsResponseSchema: AgentRegistrySettingsResponseSchema =
  agentRegistrySettingsResponseSchemaDefinition;

const organizationScope = z.object({ organizationId: z.string() });

export const governanceRegistryTrpc = defineTrpcContract("governanceRegistry")
  .query("settings")
  .withInput(organizationScope)
  .withOutput(agentRegistrySettingsSchema)

  .mutation("saveSettings")
  .withInput(z.object({ ...organizationScope.shape, dormant_after_days: dormantAfterDays }))
  .withOutput(agentRegistrySettingsSchema)
  .build();
