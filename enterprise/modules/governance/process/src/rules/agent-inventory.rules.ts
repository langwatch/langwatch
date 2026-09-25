// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AgentSource,
  DATABRICKS_GENIE_ADAPTER_ID,
  type GovernanceAgentRow,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import {
  type DiscoveredAgentRecord,
  discoveredAgentRow,
  type RegisteredAgentRecord,
  registeredAgentRow,
} from "./agent-inventory-rows.rules.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./dataverse-environment-service.rules.ts";

export type AgentInventory = { rows: GovernanceAgentRow[]; unknownProviders: string[] };

/** Closed: a provider with no chip is dropped and reported, never filed under Custom. */
const SOURCE_BY_PROVIDER: ReadonlyMap<string, AgentSource> = new Map([
  [DATABRICKS_GENIE_ADAPTER_ID, "databricks"],
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID, "copilot_studio"],
]);

/**
 * Both origins as one list, registered first, and nothing matched between them: a shared name is
 * no evidence two agents are one, and a wrong merge hides an agent where a duplicate only shows.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function buildAgentInventory({
  registered,
  discovered,
  memberNames,
  now,
}: {
  registered: readonly RegisteredAgentRecord[];
  discovered: readonly DiscoveredAgentRecord[];
  memberNames: ReadonlyMap<string, string>;
  now: Instant;
}): AgentInventory {
  const registeredRows = registered.map((agent) =>
    registeredAgentRow({
      agent,
      ownerName: agent.ownerUserId ? (memberNames.get(agent.ownerUserId) ?? null) : null,
      now,
    }),
  );

  const unknownProviders = new Set<string>();
  const discoveredRows = discovered.flatMap((agent) => {
    const source = SOURCE_BY_PROVIDER.get(agent.provider);
    if (source === undefined) {
      unknownProviders.add(agent.provider);
      return [];
    }
    return [discoveredAgentRow({ agent, source })];
  });

  return { rows: [...registeredRows, ...discoveredRows], unknownProviders: [...unknownProviders] };
}
