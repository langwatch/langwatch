// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentApi } from "@langwatch/agent-contract";
import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type { DiscoveredAgentRepository } from "../../../repositories/discovered-agent.repository.ts";
import { memberNames } from "../../identity/rules/member-names.rules.ts";
import { buildAgentInventory } from "../rules/agent-inventory.rules.ts";

type GovernanceAgentsScreenDependencies = {
  agents: Pick<AgentApi, "findConnectedInProjects">;
  projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization">;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  discoveredAgents: DiscoveredAgentRepository;
  registry: Pick<AgentRegistryRepository, "findActiveWithSourceKeys">;
  logger: Logger;
  registryPageSize: number;
};

/** How many registry entries one read asks for; the screen pages until it holds every one. */
const REGISTRY_PAGE_SIZE = 500;

/** Main's `governanceAgentsScreen.service.ts`: the Agents screen's read, from both origins. */
export class GovernanceAgentsScreenService {
  private constructor(private readonly deps: GovernanceAgentsScreenDependencies) {}

  static create({
    logger = createLogger("langwatch:governance:agents-screen"),
    registryPageSize = REGISTRY_PAGE_SIZE,
    ...deps
  }: Omit<GovernanceAgentsScreenDependencies, "logger" | "registryPageSize"> & {
    logger?: Logger;
    registryPageSize?: number;
  }): GovernanceAgentsScreenService {
    return new GovernanceAgentsScreenService({ ...deps, logger, registryPageSize });
  }

  async listAgents({
    organizationId,
    now = nowInstant(),
  }: {
    organizationId: string;
    now?: Instant;
  }): Promise<GovernanceAgentRow[]> {
    const [registered, discovered, members, registry] = await Promise.all([
      this.findRegistered({ organizationId }),
      this.deps.discoveredAgents.findByOrganization({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
      this.findActiveRegistry({ organizationId }),
    ]);

    const inventory = buildAgentInventory({
      registered,
      discovered,
      registry,
      memberNames: memberNames(members),
      now,
    });

    if (inventory.unknownProviders.length > 0) {
      this.deps.logger.warn(
        { organizationId, providers: inventory.unknownProviders },
        "discovered agents came from a provider the agents page has no source chip for; they are not listed",
      );
    }
    return inventory.rows;
  }

  /** Every active registry entry: the inventory joins each listed row and adds each traced one. */
  private async findActiveRegistry({ organizationId }: { organizationId: string }) {
    const limit = this.deps.registryPageSize;
    const entries: Awaited<ReturnType<AgentRegistryRepository["findActiveWithSourceKeys"]>> = [];
    let afterSourceKey: string | undefined;
    let page: typeof entries;
    do {
      page = await this.deps.registry.findActiveWithSourceKeys({
        organizationId,
        limit,
        afterSourceKey,
      });
      entries.push(...page);
      afterSourceKey = page.at(-1)?.sourceKey;
    } while (page.length === limit);
    return entries;
  }

  private async findRegistered({ organizationId }: { organizationId: string }) {
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    if (projectIds.length === 0) return [];
    return this.deps.agents.findConnectedInProjects({ projectIds });
  }
}
