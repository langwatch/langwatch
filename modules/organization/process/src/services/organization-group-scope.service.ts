import {
  OrganizationGroupService as OrganizationGroupServiceContract,
  type OrganizationGroupGrant,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/** Resolves the display names of group binding scopes for the group surfaces. */
export class OrganizationGroupScopeService extends OrganizationGroupServiceContract {
  static create(dependencies: {
    organizations: OrganizationService;
    projects: ProjectApi;
  }): OrganizationGroupScopeService {
    return new OrganizationGroupScopeService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      organizations: OrganizationService;
      projects: ProjectApi;
    },
  ) {
    super();
  }

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
        if (binding.scopeType === "ORGANIZATION") {
          const organization = await this.dependencies.organizations.getBillingProfile({
            organizationId: input.organizationId,
          });
          names.set(binding.scopeId, organization.name);
          return;
        }

        if (binding.scopeType === "TEAM") return;

        const project = await this.dependencies.projects.findById(binding.scopeId);
        if (project) names.set(binding.scopeId, project.name);
      }),
    );

    return names;
  }
}
