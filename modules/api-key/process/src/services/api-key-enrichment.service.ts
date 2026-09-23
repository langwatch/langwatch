import {
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyBindingNames,
  type ApiKeyListEnrichment,
} from "@langwatch/api-key-contract";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import type { ApiKeyCatalogService } from "./api-key-catalog.service.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";

async function recordScopeName({
  binding,
  resolvedOrganizationId,
  options,
  names,
}: {
  binding: ApiKeyBinding;
  resolvedOrganizationId: string | undefined;
  options: ApiKeyDependencies;
  names: {
    orgName: Map<string, string>;
    teamName: Map<string, string>;
    projectName: Map<string, string>;
    activeProjectIds: Set<string>;
  };
}): Promise<void> {
  if (binding.scopeType === "ORGANIZATION") {
    const organization = await options.organizations.getBillingProfile({
      organizationId: binding.scopeId,
    });
    names.orgName.set(binding.scopeId, organization.name);
  }

  if (binding.scopeType === "TEAM" && resolvedOrganizationId) {
    const team = await options.organizations.getTeam({
      organizationId: resolvedOrganizationId,
      teamId: binding.scopeId,
    });
    names.teamName.set(binding.scopeId, team.name);
  }

  if (binding.scopeType === "PROJECT") {
    const project = await options.projects.findById(binding.scopeId);
    if (project) {
      names.projectName.set(project.id, project.name);
      names.activeProjectIds.add(project.id);
    }
  }
}

export class ApiKeyEnrichmentService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
    catalog: ApiKeyCatalogService,
  ): ApiKeyEnrichmentService {
    return new ApiKeyEnrichmentService(options, catalog);
  }

  private constructor(
    private readonly options: ApiKeyDependencies,
    private readonly catalog: ApiKeyCatalogService,
  ) {}

  async enrichBindingsWithNames({
    bindings,
    organizationId,
  }: {
    bindings: ApiKeyBinding[];
    organizationId?: string;
  }): Promise<ApiKeyBindingNames> {
    const orgName = new Map<string, string>();
    const teamName = new Map<string, string>();
    const projectName = new Map<string, string>();
    const activeProjectIds = new Set<string>();
    const customRoleName = new Map<string, string>();
    const resolvedOrganizationId =
      organizationId ?? bindings.find((binding) => binding.scopeType === "ORGANIZATION")?.scopeId;
    const customRoles = resolvedOrganizationId
      ? await this.catalog.customRoles(
          [
            ...new Set(
              bindings.flatMap((binding) => (binding.customRoleId ? [binding.customRoleId] : [])),
            ),
          ],
          resolvedOrganizationId,
        )
      : [];

    for (const role of customRoles) {
      customRoleName.set(role.id, role.name);
    }

    for (const binding of bindings) {
      await recordScopeName({
        binding,
        resolvedOrganizationId,
        options: this.options,
        names: { orgName, teamName, projectName, activeProjectIds },
      });
    }

    return {
      orgName,
      teamName,
      activeProjectIds,
      projectName,
      customRoleName,
      customRoles,
    };
  }

  async enrichApiKeyList({ apiKeys }: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment> {
    const organizationId = apiKeys[0]?.organizationId;
    const customRoles = organizationId
      ? await this.catalog.customRoles(
          [
            ...new Set(
              apiKeys.flatMap((key) =>
                key.roleBindings.flatMap((binding) =>
                  binding.customRoleId ? [binding.customRoleId] : [],
                ),
              ),
            ),
          ],
          organizationId,
        )
      : [];
    if (!organizationId) {
      return { customRoles, users: [] };
    }

    const userIds = new Set(
      apiKeys.flatMap((key) =>
        [key.userId, key.createdByUserId].filter((value): value is string => Boolean(value)),
      ),
    );
    const users = (
      await this.options.authz.listOrganizationBindings({
        organizationId,
      })
    ).flatMap((binding) =>
      binding.user && userIds.has(binding.user.id)
        ? [
            {
              id: binding.user.id,
              name: binding.user.name,
              email: binding.user.email,
            },
          ]
        : [],
    );

    return {
      customRoles,
      users: [...new Map(users.map((user) => [user.id, user])).values()],
    };
  }
}
