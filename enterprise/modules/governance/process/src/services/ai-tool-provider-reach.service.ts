// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

type ProviderScope = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

/** Which model providers are live for a member or an organization (main `aiToolEntry.service.ts:1268-1396`). */
export class AiToolProviderReachService {
  private constructor(
    private readonly organizations: Pick<
      OrganizationApi,
      "findMemberTeamIds" | "findTeamsWithDepartments"
    >,
    private readonly projects: Pick<ProjectApi, "listByTeam" | "listIdsByOrganization">,
    private readonly modelProviders: Pick<ModelProviderApi, "findEnabledProviderKeysInScopes">,
  ) {}

  static create(options: {
    organizations: Pick<OrganizationApi, "findMemberTeamIds" | "findTeamsWithDepartments">;
    projects: Pick<ProjectApi, "listByTeam" | "listIdsByOrganization">;
    modelProviders: Pick<ModelProviderApi, "findEnabledProviderKeysInScopes">;
  }): AiToolProviderReachService {
    return new AiToolProviderReachService(
      options.organizations,
      options.projects,
      options.modelProviders,
    );
  }

  /** Org-wide providers, plus those on a team the member belongs to or one of its projects. */
  async findConfiguredForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<string[]> {
    const teamIds = await this.organizations.findMemberTeamIds(input);
    const projects = await Promise.all(
      teamIds.map((teamId) =>
        this.projects.listByTeam({ organizationId: input.organizationId, teamId }),
      ),
    );
    return this.findConfigured({
      organizationId: input.organizationId,
      teamIds,
      projectIds: projects.flat().map(({ id }) => id),
    });
  }

  /** Every provider configured anywhere in the organization. */
  async findConfiguredForOrganization(organizationId: string): Promise<string[]> {
    const [teams, projectIds] = await Promise.all([
      this.organizations.findTeamsWithDepartments({ organizationId }),
      this.projects.listIdsByOrganization({ organizationId }),
    ]);
    return this.findConfigured({ organizationId, teamIds: teams.map(({ id }) => id), projectIds });
  }

  private findConfigured(input: {
    organizationId: string;
    teamIds: readonly string[];
    projectIds: readonly string[];
  }): Promise<string[]> {
    const scopes: ProviderScope[] = [
      { scopeType: "ORGANIZATION", scopeId: input.organizationId },
      ...input.teamIds.map((scopeId): ProviderScope => ({ scopeType: "TEAM", scopeId })),
      ...input.projectIds.map((scopeId): ProviderScope => ({ scopeType: "PROJECT", scopeId })),
    ];
    return this.modelProviders.findEnabledProviderKeysInScopes({ scopes });
  }
}
