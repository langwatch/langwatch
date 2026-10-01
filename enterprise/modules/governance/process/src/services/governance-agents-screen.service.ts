// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentApi } from "@langwatch/agent-contract";
import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { DiscoveredAgentRepository } from "../repositories/discovered-agent.repository.ts";
import { buildAgentInventory } from "../rules/agent-inventory.rules.ts";
import { memberNames } from "../rules/member-names.rules.ts";

type GovernanceAgentsScreenDependencies = {
  agents: Pick<AgentApi, "findConnectedInProjects">;
  projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization">;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  discoveredAgents: DiscoveredAgentRepository;
  logger: Logger;
};

/** Main's `governanceAgentsScreen.service.ts`: the Agents screen's read, from both origins. */
export class GovernanceAgentsScreenService {
  private constructor(private readonly deps: GovernanceAgentsScreenDependencies) {}

  static create({
    logger = createLogger("langwatch:governance:agents-screen"),
    ...deps
  }: Omit<GovernanceAgentsScreenDependencies, "logger"> & {
    logger?: Logger;
  }): GovernanceAgentsScreenService {
    return new GovernanceAgentsScreenService({ ...deps, logger });
  }

  async listAgents({
    organizationId,
    now = nowInstant(),
  }: {
    organizationId: string;
    now?: Instant;
  }): Promise<GovernanceAgentRow[]> {
    const [registered, discovered, members] = await Promise.all([
      this.findRegistered({ organizationId }),
      this.deps.discoveredAgents.findByOrganization({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
    ]);

    const inventory = buildAgentInventory({
      registered,
      discovered,
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

  private async findRegistered({ organizationId }: { organizationId: string }) {
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    if (projectIds.length === 0) return [];
    return this.deps.agents.findConnectedInProjects({ projectIds });
  }
}
