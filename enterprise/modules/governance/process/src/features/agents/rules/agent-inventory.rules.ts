// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AgentSource,
  ARD_REGISTRY_ADAPTER_ID,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  DATABRICKS_GENIE_ADAPTER_ID,
  GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
  type GovernanceAgentRow,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../microsoft/rules/dataverse-environment-service.rules.ts";
import {
  type DiscoveredAgentRecord,
  discoveredAgentRow,
  type RegisteredAgentRecord,
  registeredAgentRow,
  type RegistryInventoryEntry,
  trafficAgentRow,
} from "./agent-inventory-rows.rules.ts";

type AgentInventory = { rows: GovernanceAgentRow[]; unknownProviders: string[] };

/** Closed: a provider with no chip is dropped and reported, never filed under Custom. */
export const AGENT_SOURCE_BY_PROVIDER: ReadonlyMap<string, AgentSource> = new Map([
  [DATABRICKS_GENIE_ADAPTER_ID, "databricks"],
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID, "copilot_studio"],
  [AWS_BEDROCK_AGENTS_ADAPTER_ID, "aws"],
  [GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID, "gcp"],
  [ARD_REGISTRY_ADAPTER_ID, "ard"],
]);

/**
 * Every origin as one list (registered, discovered, traced-only shadow) and nothing matched
 * between them: a shared name is no evidence two agents are one, and a wrong merge hides one.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function buildAgentInventory({
  registered,
  discovered,
  registry = [],
  memberNames,
  now,
}: {
  registered: readonly RegisteredAgentRecord[];
  discovered: readonly DiscoveredAgentRecord[];
  /** The registry's active entries: each row's posture and platform, and the traced-only agents. */
  registry?: readonly RegistryInventoryEntry[];
  memberNames: ReadonlyMap<string, string>;
  now: Instant;
}): AgentInventory {
  const bySourceKey = new Map(registry.map(({ sourceKey, entry }) => [sourceKey, entry]));
  const withPosture = (row: GovernanceAgentRow, sourceKey: string): GovernanceAgentRow => {
    const entry = bySourceKey.get(sourceKey);
    if (!entry) return row;
    // A listed agent's model comes from its source's listing, which only the registry entry holds.
    const models = row.models.length === 0 && entry.model ? [entry.model.model] : row.models;
    return { ...row, posture: entry.posture, platform: entry.platform, models };
  };

  const registeredRows = registered.map((agent) =>
    withPosture(
      registeredAgentRow({
        agent,
        ownerName: agent.ownerUserId ? (memberNames.get(agent.ownerUserId) ?? null) : null,
        now,
      }),
      `langwatch:${agent.id}`,
    ),
  );

  const unknownProviders = new Set<string>();
  const discoveredRows = discovered.flatMap((agent) => {
    const source = AGENT_SOURCE_BY_PROVIDER.get(agent.provider);
    if (source === undefined) {
      unknownProviders.add(agent.provider);
      return [];
    }
    return [withPosture(discoveredAgentRow({ agent, source }), `discovered:${agent.id}`)];
  });

  const trafficRows = registry
    .filter(({ entry }) => entry.source === "traffic")
    .map(({ entry }) => trafficAgentRow({ entry, now }));

  return {
    rows: [...registeredRows, ...discoveredRows, ...trafficRows],
    unknownProviders: [...unknownProviders],
  };
}
