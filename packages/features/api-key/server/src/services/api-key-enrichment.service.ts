import {
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyBindingNames,
  type ApiKeyListEnrichment,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository } from "../repositories/api-key.repository";
import { ApiKeyCatalogService } from "./api-key-catalog.service";
import type { ApiKeyDependencies } from "./api-key.service";

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
      organizationId ??
      bindings.find((binding) => binding.scopeType === "ORGANIZATION")?.scopeId;
    const customRoles = resolvedOrganizationId
      ? await this.catalog.customRoles(
          [
            ...new Set(
              bindings.flatMap((binding) =>
                binding.customRoleId ? [binding.customRoleId] : [],
              ),
            ),
          ],
          resolvedOrganizationId,
        )
      : [];

    for (const role of customRoles) {
      customRoleName.set(role.id, role.name);
    }
    for (const binding of bindings) {
      if (binding.scopeType === "ORGANIZATION") {
        const organization = await this.options.organizations.getBillingProfile({
          organizationId: binding.scopeId,
        });
        orgName.set(binding.scopeId, organization.name);
      }
      if (binding.scopeType === "TEAM" && resolvedOrganizationId) {
        const team = await this.options.organizations.getTeam({
          organizationId: resolvedOrganizationId,
          teamId: binding.scopeId,
        });
        teamName.set(binding.scopeId, team.name);
      }
      if (binding.scopeType === "PROJECT") {
        const project = await this.options.projects.tryGetById(binding.scopeId);
        if (project) {
          projectName.set(project.id, project.name);
          activeProjectIds.add(project.id);
        }
      }
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

  async enrichApiKeyList({
    apiKeys,
  }: {
    apiKeys: ApiKey[];
  }): Promise<ApiKeyListEnrichment> {
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
        [key.userId, key.createdByUserId].filter((value): value is string =>
          Boolean(value),
        ),
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
