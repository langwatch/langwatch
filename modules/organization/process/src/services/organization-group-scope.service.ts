import type { OrganizationGroupGrant } from "@langwatch/organization-contract";

import type { OrganizationService } from "./organization.service.ts";

/** The organization reads a group scope's name needs, from the process service. */
type GroupScopeOrganizations = Pick<
  OrganizationService,
  "listTeams" | "getBillingProfile" | "findProjectNames"
>;

/** Resolves the display names of group binding scopes for the group surfaces. */
export class OrganizationGroupScopeService {
  static create(dependencies: {
    organizations: GroupScopeOrganizations;
  }): OrganizationGroupScopeService {
    return new OrganizationGroupScopeService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      organizations: GroupScopeOrganizations;
    },
  ) {}

  async resolveBindingScopeNames(input: {
    organizationId: string;
    bindings: readonly OrganizationGroupGrant[];
  }): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    const uniqueBindings = [
      ...new Map(input.bindings.map((binding) => [binding.scopeId, binding])).values(),
    ];

    if (uniqueBindings.some((binding) => binding.scopeType === "TEAM")) {
      // One read names every team; a grant on an archived team is left unnamed, never an error.
      const teams = await this.dependencies.organizations.listTeams({
        organizationId: input.organizationId,
        page: 1,
        limit: 1_000,
      });
      for (const team of teams.data) names.set(team.id, team.name);
    }

    await Promise.all(
      uniqueBindings.map(async (binding) => {
        if (binding.scopeType !== "ORGANIZATION") return;
        const organization = await this.dependencies.organizations.getBillingProfile({
          organizationId: input.organizationId,
        });
        names.set(binding.scopeId, organization.name);
      }),
    );

    // One read names every project grant; a project that no longer exists is left unnamed.
    const projectIds = uniqueBindings.flatMap((binding) =>
      binding.scopeType === "PROJECT" ? [binding.scopeId] : [],
    );
    if (projectIds.length > 0) {
      const projects = await this.dependencies.organizations.findProjectNames(projectIds);
      for (const project of projects) names.set(project.id, project.name);
    }

    return names;
  }
}
