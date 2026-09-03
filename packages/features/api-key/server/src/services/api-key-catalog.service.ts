import {
  ApiKeyNotFoundError,
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyDetail,
  type ApiKeyName,
  type ApiKeyProject,
  type ApiKeyRoleSummary,
  type ApiKeyTeam,
  type ApiKeyUser,
  HIDDEN_SYSTEM_KEY_NAMES,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository";
import type { ApiKeyDependencies } from "./api-key.service";

const SYSTEM_NAMES = new Set(HIDDEN_SYSTEM_KEY_NAMES);

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;
  return key;
}

function isApiKeyVisibleToMember(key: ApiKey, userId: string | null): boolean {
  return Boolean(
    userId && (key.userId === userId || (key.userId === null && key.ingestSourceType === null)),
  );
}

export class ApiKeyCatalogService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
  ): ApiKeyCatalogService {
    return new ApiKeyCatalogService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {}

  async tryGetById({ id }: { id: string }): Promise<ApiKey | null> {
    const row = await this.repository.tryFindById({ id });
    return row ? publicApiKey(row) : null;
  }

  async getByIdForCaller(input: {
    id: string;
    organizationId: string;
    callerUserId: string | null;
    callerCanReadAnyKey: boolean;
  }): Promise<ApiKeyDetail> {
    const row = await this.getInOrganization(input.id, input.organizationId);
    if (
      SYSTEM_NAMES.has(row.name) ||
      (!input.callerCanReadAnyKey && !isApiKeyVisibleToMember(row, input.callerUserId))
    ) {
      throw new ApiKeyNotFoundError(input.id);
    }
    return {
      ...publicApiKey(row),
      permissions: await this.customPermissions(row, input.organizationId),
    };
  }

  async tryGetNameByIdInOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyName | null> {
    const row = await this.repository.tryFindByIdInOrganization(input);
    return row ? { name: row.name, revoked: row.revokedAt !== null } : null;
  }

  async getUserBindings(input: {
    userId: string;
    organizationId: string;
  }): Promise<ApiKeyBinding[]> {
    const bindings = await this.options.authz.listUserBindings(input);
    return bindings.map((binding) => ({
      id: binding.id,
      role: binding.role,
      customRoleId: binding.customRoleId,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    }));
  }

  async getOrgProjects({ organizationId }: { organizationId: string }): Promise<ApiKeyProject[]> {
    const page = await this.options.projects.listByOrganization({
      organizationId,
      page: 1,
      limit: 1000,
    });
    return page.data.map((project) => ({
      id: project.id,
      name: project.name,
      teamId: project.teamId,
    }));
  }

  async getOrgTeams({ organizationId }: { organizationId: string }): Promise<ApiKeyTeam[]> {
    const page = await this.options.organizations.listTeams({
      organizationId,
      page: 1,
      limit: 1000,
    });
    return page.data.map((team) => ({ id: team.id, name: team.name }));
  }

  async getOrgMembers({ organizationId }: { organizationId: string }): Promise<ApiKeyUser[]> {
    const members = new Map<string, ApiKeyUser>();
    for (const binding of await this.options.authz.listOrganizationBindings({
      organizationId,
    })) {
      if (binding.user) {
        members.set(binding.user.id, {
          id: binding.user.id,
          name: binding.user.name,
          email: binding.user.email,
        });
      }
    }
    return [...members.values()];
  }

  async list(input: { userId: string; organizationId: string }): Promise<ApiKey[]> {
    const rows = await this.repository.listForUser(input);
    return rows.map(publicApiKey);
  }

  async listAll({ organizationId }: { organizationId: string }): Promise<ApiKey[]> {
    const rows = await this.repository.listForOrganization({ organizationId });
    return rows.map(publicApiKey);
  }

  async tryGetIngestionKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<ApiKey | null> {
    const row = await this.repository.tryFindIngestKey(input);
    return row ? publicApiKey(row) : null;
  }

  async listIngestionKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ApiKey[]> {
    const rows = await this.repository.findIngestKeysForProject(input);
    return rows.map(publicApiKey);
  }

  async customRoles(ids: string[], organizationId: string): Promise<ApiKeyRoleSummary[]> {
    if (ids.length === 0) {
      return [];
    }
    const roles = await this.options.authz.listUserCreatedRoles({ organizationId });
    return roles
      .filter((role) => ids.includes(role.id))
      .map((role) => ({
        id: role.id,
        name: role.name,
        permissions:
          Array.isArray(role.permissions) &&
          role.permissions.every(
            (permission): permission is string => typeof permission === "string",
          )
            ? role.permissions
            : [],
      }));
  }

  private async getInOrganization(id: string, organizationId: string): Promise<StoredApiKey> {
    const row = await this.repository.tryFindByIdInOrganization({
      id,
      organizationId,
    });
    if (!row) {
      throw new ApiKeyNotFoundError(id);
    }
    return row;
  }

  private async customPermissions(row: StoredApiKey, organizationId: string): Promise<string[]> {
    const ids = new Set(
      row.roleBindings.flatMap((binding) => (binding.customRoleId ? [binding.customRoleId] : [])),
    );
    if (ids.size === 0) {
      return [];
    }
    const roles = await this.options.authz.listUserCreatedRoles({
      organizationId,
    });
    return [
      ...new Set(
        roles
          .filter((role) => ids.has(role.id) && Array.isArray(role.permissions))
          .flatMap((role) =>
            Array.isArray(role.permissions)
              ? role.permissions.filter(
                  (permission): permission is string => typeof permission === "string",
                )
              : [],
          ),
      ),
    ].sort();
  }
}
