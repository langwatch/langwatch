// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { DiscoveredAgentRepository } from "../../../repositories/discovered-agent.repository.ts";
import { AGENT_SOURCE_BY_PROVIDER } from "../../agents/rules/agent-inventory.rules.ts";
import { memberNames } from "../../identity/rules/member-names.rules.ts";
import {
  discoveredAgentDraft,
  langwatchAgentDraft,
  type RegistryDraft,
} from "../rules/registry-entry.rules.ts";
import type { StoredRegistryEntry } from "../rules/registry-reconcile.rules.ts";
import {
  keepsUnreadTraffic,
  REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
  REGISTRY_TRAFFIC_WINDOW_MS,
  trafficAgentDrafts,
} from "../rules/registry-traffic.rules.ts";

const AGENTS_PAGE_LIMIT = 200;

export type AgentRegistrySourcesDependencies = {
  discoveredAgents: Pick<DiscoveredAgentRepository, "findForRegistry">;
  agents: Pick<AgentApi, "list" | "platformUrl">;
  projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization" | "listNamesByIds">;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  traces: Pick<TraceApi, "findAgentsSeen">;
  publicBaseUrl: string;
  now: () => Instant;
};

/** What one read of the sources saw, and which held entries an incomplete read cannot judge. */
export type AgentRegistrySourcesRead = {
  drafts: RegistryDraft[];
  keep: (held: StoredRegistryEntry) => boolean;
};

/**
 * Reads every source the registry is built from: LangWatch agents, discovered provider agents
 * and the agents traces name. Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
export class AgentRegistrySourcesService {
  private constructor(private readonly deps: AgentRegistrySourcesDependencies) {}

  static create(deps: AgentRegistrySourcesDependencies): AgentRegistrySourcesService {
    return new AgentRegistrySourcesService(deps);
  }

  async read({ organizationId }: { organizationId: string }): Promise<AgentRegistrySourcesRead> {
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    const [agents, discovered, members, projects] = await Promise.all([
      this.agentsOf(projectIds),
      this.deps.discoveredAgents.findForRegistry({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
      projectIds.length > 0
        ? this.deps.projects.listNamesByIds({ projectIds })
        : Promise.resolve([]),
    ]);
    const names = memberNames(members);
    const slugs = new Map(projects.map((project) => [project.id, project.slug]));

    const listed: RegistryDraft[] = agents.map((agent) => {
      const slug = slugs.get(agent.projectId);
      return langwatchAgentDraft({
        agent,
        ownerName: agent.ownerUserId ? (names.get(agent.ownerUserId) ?? null) : null,
        publicBaseUrl: this.deps.publicBaseUrl,
        consoleUrl: slug
          ? this.deps.agents.platformUrl({
              projectSlug: slug,
              agentId: agent.id,
              agentType: agent.type,
            })
          : null,
      });
    });
    for (const row of discovered) {
      const source = AGENT_SOURCE_BY_PROVIDER.get(row.provider);
      if (source === "databricks" || source === "copilot_studio") {
        listed.push(discoveredAgentDraft({ ...row, source }));
      }
    }

    const since = this.deps.now().epochMilliseconds - REGISTRY_TRAFFIC_WINDOW_MS;
    const seen = await Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        agents: await this.deps.traces.findAgentsSeen({
          projectId,
          sinceMs: since,
          limit: REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
        }),
      })),
    );
    return {
      drafts: [...listed, ...trafficAgentDrafts({ seen, listed })],
      keep: keepsUnreadTraffic({ seen }),
    };
  }

  private async agentsOf(projectIds: readonly string[]): Promise<Agent[]> {
    const agents: Agent[] = [];
    for (const projectId of projectIds) {
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page++) {
        const result = await this.deps.agents.list({ projectId, page, limit: AGENTS_PAGE_LIMIT });
        agents.push(...result.data);
        totalPages = result.pagination.totalPages;
      }
    }
    return agents;
  }
}
