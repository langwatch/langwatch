import type { ScopeGraphOrganization } from "@langwatch/organization-contract";

import type { OrganizationScopeGraphReader } from "../../services/organization-scope-graph.service.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/**
 * In-memory {@link OrganizationScopeGraphReader}. The memory rows carry no pricing,
 * SSO, project kind or project chrome columns, so those read as their Postgres defaults.
 */
export class MemoryScopeGraphRepository implements OrganizationScopeGraphReader {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {}

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryScopeGraphRepository {
    return new MemoryScopeGraphRepository(options.memory);
  }

  async findScopeGraphForUser({ userId }: { userId: string }): Promise<ScopeGraphOrganization[]> {
    const { memory } = this;
    const activeRows = memory.organizationUsers.filter(
      (row) => row.userId === userId && row.disabledAt === null,
    );

    return [...memory.organizations.values()].flatMap<ScopeGraphOrganization>((organization) => {
      const own = activeRows.find((row) => row.organizationId === organization.id);
      if (!own) return [];

      const teams = [...memory.teams.values()]
        .filter((team) => team.organizationId === organization.id && team.archivedAt === null)
        .map((team) => ({
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: team.isPersonal,
          ownerUserId: team.ownerUserId,
          personalOf: team.isPersonal ? team.ownerUserId : null,
          members: memory.teamUsers
            .filter((row) => row.teamId === team.id && row.userId === userId)
            .map((row) => ({ userId: row.userId })),
          projects: [...memory.projects.values()]
            .filter((project) => project.teamId === team.id && project.archivedAt === null)
            .map((project) => ({
              id: project.id,
              slug: project.slug,
              name: project.name,
              userLinkTemplate: null,
              presenceEnabled: true,
              lastCodingAgentSessionAt: null,
              lastCodingAgentPullRequestAt: null,
            })),
        }));

      return [
        {
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          primaryIntent: organization.primaryIntent,
          presenceEnabled: organization.presenceEnabled,
          pricingModel: "TIERED",
          ssoProvider: null,
          members: [{ role: own.role }],
          teams,
        },
      ];
    });
  }
}
