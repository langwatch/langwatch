import {
  OrganizationGroupService as OrganizationGroupServiceContract,
  type OrganizationGroupBinding,
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
    bindings: readonly OrganizationGroupBinding[];
  }): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    const uniqueBindings = [
      ...new Map(input.bindings.map((binding) => [binding.scopeId, binding])).values(),
    ];

    await Promise.all(
      uniqueBindings.map(async (binding) => {
        if (binding.scopeType === "ORGANIZATION") {
          const organization = await this.dependencies.organizations.getBillingProfile({
            organizationId: input.organizationId,
          });
          names.set(binding.scopeId, organization.name);
          return;
        }

        if (binding.scopeType === "TEAM") {
          const team = await this.dependencies.organizations.getTeam({
            organizationId: input.organizationId,
            teamId: binding.scopeId,
          });
          names.set(binding.scopeId, team.name);
          return;
        }

        const project = await this.dependencies.projects.tryGetById(binding.scopeId);
        if (project) names.set(binding.scopeId, project.name);
      }),
    );

    return names;
  }
}
