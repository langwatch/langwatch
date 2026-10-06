import type { ShareableResourceKind } from "@langwatch/authorization";
import type { AuthzPrincipalRef, CollectedBinding } from "@langwatch/authz-contract";

import {
  AuthzReadRepository,
  type CustomRolePermissionsRow,
  type OrganizationMembership,
  type ShareLinkRow,
} from "../authz-read.repository.ts";
import {
  BINDING_SCOPE_TYPES,
  collectBindings,
  rolesExclusiveTo,
  shareLinkRowFrom,
  SYSTEM_API_KEY_ROLE_KIND,
} from "../eventing/eventing.authz-read.mapper.ts";
import { RESOURCE_KIND_TO_DB } from "../prisma/prisma.authz-grant.mapper.ts";
import type { AuthzMemoryGrantRow, AuthzMemoryStore } from "./authz-memory.store.ts";

/** The decision reads over the memory heads, with the grant-head repository's predicates. */
export class MemoryAuthzReadRepository extends AuthzReadRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzReadRepository {
    return new MemoryAuthzReadRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  beginPass(): AuthzReadRepository {
    return this;
  }

  // Arrow instance properties, matching the base class's property-typed abstract members.
  findOrganizationMembership = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null> => {
    const row = this.memory.memberships.get(this.memory.membershipKey(organizationId, userId));
    return row ? { role: row.role, disabled: row.disabled } : null;
  };

  findUserBindings = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    if (!this.isCurrentMember({ userId, organizationId })) return [];
    const rows = this.bindingGrants({ organizationId, principalType: "USER", ids: [userId] });
    return collectBindings({ rows, viaGroupId: () => null });
  };

  findGroupBindings = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    if (!this.isCurrentMember({ userId, organizationId })) return [];
    const groupIds = this.memory.groupMemberships
      .filter((row) => row.userId === userId && this.memory.isGroupIn(row.groupId, organizationId))
      .map((row) => row.groupId);
    if (groupIds.length === 0) return [];
    const rows = this.bindingGrants({ organizationId, principalType: "GROUP", ids: groupIds });
    return collectBindings({ rows, viaGroupId: (row) => row.principalId });
  };

  findApiKeyBindings = async ({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    const rows = this.bindingGrants({ organizationId, principalType: "API_KEY", ids: [apiKeyId] });
    return collectBindings({ rows, viaGroupId: () => null });
  };

  findCustomRolePermissions = async ({
    organizationId,
    principal,
    customRoleIds,
  }: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> => {
    if (customRoleIds.length === 0) return [];
    const apiKeyId = principal.type === "apiKey" ? principal.id : null;
    const rows = this.memory.roleHeads.filter(
      (row) =>
        row.deletedAt === null &&
        customRoleIds.includes(row.id) &&
        row.organizationId === organizationId &&
        (apiKeyId !== null || row.kind !== SYSTEM_API_KEY_ROLE_KIND),
    );
    const systemRoleIds = rows
      .filter((row) => row.kind === SYSTEM_API_KEY_ROLE_KIND)
      .map((row) => `custom:${row.id}`);
    const exclusive =
      systemRoleIds.length === 0 || apiKeyId === null
        ? new Set<string>()
        : rolesExclusiveTo({
            holders: this.liveGrants().filter(
              (row) =>
                row.organizationId === organizationId &&
                row.roleKey !== null &&
                systemRoleIds.includes(row.roleKey),
            ),
            apiKeyId,
          });
    return rows
      .filter(
        (row) =>
          apiKeyId === null || row.kind !== SYSTEM_API_KEY_ROLE_KIND || exclusive.has(row.id),
      )
      .map(({ id, permissions }) => ({ id, permissions }));
  };

  findApiKeyOwner = async (apiKeyId: string): Promise<{ userId: string | null } | null> => {
    const row = this.memory.apiKeys.find((candidate) => candidate.id === apiKeyId);
    return row ? { userId: row.userId } : null;
  };

  findShareLinks = async ({
    projectId,
    tokens,
    links,
    organizationId,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: readonly { kind: ShareableResourceKind; id: string }[];
    organizationId?: string;
  }): Promise<ShareLinkRow[]> => {
    if (tokens.length === 0 || links.length === 0) return [];
    const resolvedOrganizationId =
      organizationId ?? (await this.findProjectLineage({ projectId }))?.organizationId;
    if (!resolvedOrganizationId) return [];

    const rows = this.liveGrants().filter(
      (row) =>
        row.organizationId === resolvedOrganizationId &&
        row.projectId === projectId &&
        row.scopeType === "RESOURCE" &&
        row.token !== null &&
        tokens.includes(row.token) &&
        links.some(
          (link) => row.resourceKind === RESOURCE_KIND_TO_DB[link.kind] && row.scopeId === link.id,
        ),
    );
    if (rows.length === 0) return [];
    const viewCounts = new Map(
      this.memory.grantUsages
        .filter(
          (usage) =>
            usage.organizationId === resolvedOrganizationId &&
            rows.some((row) => row.id === usage.grantId),
        )
        .map((usage) => [usage.grantId, usage.viewCount]),
    );
    return rows.flatMap((row) => shareLinkRowFrom({ row, viewCounts }));
  };

  findProjectLineage = async ({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> => {
    const project = this.memory.projects.find((row) => row.id === projectId);
    const team = this.memory.teams.find((row) => row.id === project?.teamId);
    if (!project || !team) return null;
    return { teamId: team.id, organizationId: team.organizationId };
  };

  findTeamOrganization = async ({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> => {
    const team = this.memory.teams.find((row) => row.id === teamId);
    return team ? { organizationId: team.organizationId } : null;
  };

  /** A seat-disabled membership confers no grants, exactly as a removed one does. */
  private isCurrentMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): boolean {
    const membership = this.memory.memberships.get(
      this.memory.membershipKey(organizationId, userId),
    );
    return membership !== undefined && !membership.disabled;
  }

  private liveGrants(): AuthzMemoryGrantRow[] {
    return this.memory.grants.filter((row) => row.revokedAt === null);
  }

  private bindingGrants({
    organizationId,
    principalType,
    ids,
  }: {
    organizationId: string;
    principalType: AuthzMemoryGrantRow["principalType"];
    ids: readonly string[];
  }): (AuthzMemoryGrantRow & { principalId: string })[] {
    return this.liveGrants().filter(
      (row): row is AuthzMemoryGrantRow & { principalId: string } =>
        row.organizationId === organizationId &&
        row.principalType === principalType &&
        row.principalId !== null &&
        ids.includes(row.principalId) &&
        (BINDING_SCOPE_TYPES as readonly string[]).includes(row.scopeType),
    );
  }
}
