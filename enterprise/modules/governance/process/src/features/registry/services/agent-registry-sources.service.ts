// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { AgentRegistrySettingsRepository } from "../../../repositories/agent-registry-settings.repository.ts";
import type { DiscoveredAgentRepository } from "../../../repositories/discovered-agent.repository.ts";
import { AGENT_SOURCE_BY_PROVIDER } from "../../agents/rules/agent-inventory.rules.ts";
import { memberNames } from "../../identity/rules/member-names.rules.ts";
import {
  discoveredAgentDraft,
  type DiscoveredRegistrySource,
  langwatchAgentDraft,
  type RegistryDraft,
} from "../rules/registry-entry.rules.ts";
import type { StoredRegistryEntry } from "../rules/registry-reconcile.rules.ts";
import {
  keepsTrafficInWindow,
  REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
  REGISTRY_TRAFFIC_WINDOW_MS,
  registryTrafficReadWindowMs,
  seenSince,
  trafficAgentDrafts,
  withDormancy,
} from "../rules/registry-traffic.rules.ts";

const AGENTS_PAGE_LIMIT = 200;

const DISCOVERED_REGISTRY_SOURCES: ReadonlySet<string> = new Set<DiscoveredRegistrySource>([
  "databricks",
  "copilot_studio",
  "aws",
  "gcp",
  "ard",
]);

function isDiscoveredRegistrySource(
  source: string | undefined,
): source is DiscoveredRegistrySource {
  return source !== undefined && DISCOVERED_REGISTRY_SOURCES.has(source);
}

export type AgentRegistrySourcesDependencies = {
  discoveredAgents: Pick<DiscoveredAgentRepository, "findForRegistry">;
  agents: Pick<AgentApi, "list" | "platformUrl">;
  projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization" | "listNamesByIds">;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  traces: Pick<TraceApi, "findAgentsSeen">;
  /** The organisation's dormancy window. */
  settings: Pick<AgentRegistrySettingsRepository, "getDormantAfterDays">;
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
    const [{ agents, incompleteProjects }, discovered, members, projects, dormantAfterDays] =
      await Promise.all([
        this.agentsOf(projectIds),
        this.deps.discoveredAgents.findForRegistry({ organizationId }),
        this.deps.organizations.findMembersWithDepartments({ organizationId }),
        projectIds.length > 0
          ? this.deps.projects.listNamesByIds({ projectIds })
          : Promise.resolve([]),
        this.deps.settings.getDormantAfterDays({ organizationId }),
      ]);
    const names = memberNames(members);
    const slugs = new Map(projects.map((project) => [project.id, project.slug]));

    const described: RegistryDraft[] = agents.map((agent) => {
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
      if (isDiscoveredRegistrySource(source)) {
        described.push(discoveredAgentDraft({ ...row, source }));
      }
    }

    const nowMs = this.deps.now().epochMilliseconds;
    const since = nowMs - REGISTRY_TRAFFIC_WINDOW_MS;
    const read = await this.trafficOf({
      projectIds,
      sinceMs: nowMs - registryTrafficReadWindowMs(dormantAfterDays),
    });
    const unsettled = new Set([
      ...incompleteProjects,
      ...read
        .filter(({ agents }) => agents.length >= REGISTRY_TRAFFIC_LIMIT_PER_PROJECT)
        .map(({ projectId }) => projectId),
    ]);
    const listed = withDormancy({
      listed: described,
      seen: read,
      nowMs,
      dormantAfterDays,
      unsettledProjectIds: unsettled,
    });
    const seen = seenSince({ seen: read, sinceMs: since });
    const keepTraffic = keepsTrafficInWindow({
      sinceMs: since,
      projectIds,
      unsettledProjectIds: unsettled,
      listed,
    });
    const settledSeen = seen.filter(({ projectId }) => !incompleteProjects.has(projectId));
    return {
      drafts: [...listed, ...trafficAgentDrafts({ seen: settledSeen, listed })],
      keep: (held) =>
        keepTraffic(held) ||
        (held.entry.source === "langwatch" &&
          held.entry.project_id !== null &&
          incompleteProjects.has(held.entry.project_id)),
    };
  }

  /** The agents each project's traces named since `sinceMs`, capped per project. */
  private trafficOf({ projectIds, sinceMs }: { projectIds: readonly string[]; sinceMs: number }) {
    return Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        agents: await this.deps.traces.findAgentsSeen({
          projectId,
          sinceMs,
          limit: REGISTRY_TRAFFIC_LIMIT_PER_PROJECT,
        }),
      })),
    );
  }

  /**
   * A project whose pages, read by offset, came back short of the largest total any page named
   * read incomplete, so an archive during the walk cannot hide an agent it skipped.
   */
  private async agentsOf(
    projectIds: readonly string[],
  ): Promise<{ agents: Agent[]; incompleteProjects: Set<string> }> {
    const agents = new Map<string, Agent>();
    const incompleteProjects = new Set<string>();
    for (const projectId of projectIds) {
      const before = agents.size;
      let totalPages = 1;
      let total = 0;
      for (let page = 1; page <= totalPages; page++) {
        const result = await this.deps.agents.list({ projectId, page, limit: AGENTS_PAGE_LIMIT });
        for (const agent of result.data) agents.set(agent.id, agent);
        totalPages = Math.max(totalPages, result.pagination.totalPages);
        total = Math.max(total, result.pagination.total);
      }
      if (agents.size - before < total) incompleteProjects.add(projectId);
    }
    return { agents: [...agents.values()], incompleteProjects };
  }
}
