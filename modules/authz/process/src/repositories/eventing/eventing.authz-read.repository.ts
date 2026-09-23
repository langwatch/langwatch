// Read repository for cut-over organizations; deliberately independent for parity verification.
import type {
  AuthzPrincipalRef,
  BindingRoleKey,
  CollectedBinding,
  RoleBindingScopeType,
  ShareableResourceKind,
} from "@langwatch/authz-contract";
import { type Instant, fromDate } from "@langwatch/time";

import {
  AuthzReadRepository,
  type AuthzDatabase,
  type CustomRolePermissionsRow,
  type OrganizationMembership,
  type OrganizationRole,
  type ShareLinkRow,
} from "../authz-read.repository.ts";
import {
  RESOURCE_KIND_TO_DB,
  SHARE_VISIBILITY_BY_PRINCIPAL_DB,
} from "../prisma/prisma.authz-grant.mapper.ts";
import { liveGrants, liveRoles } from "./eventing.authz-live-rows.mapper.ts";

const SYSTEM_API_KEY_ROLE_KIND = "system_api_key" as const;

/** The three scope tiers a `CollectedBinding` can carry. RESOURCE rows are
 *  the share tier (findShareLinks) and PLATFORM rows are dormant facts that
 *  no PR-3 decision reads, so neither belongs in a binding list. */
const BINDING_SCOPE_TYPES: readonly RoleBindingScopeType[] = ["ORGANIZATION", "TEAM", "PROJECT"];

type BindingGrantRow = {
  roleKey: string | null;
  scopeType: string;
  scopeId: string;
};

export class EventingAuthzReadRepository extends AuthzReadRepository {
  static create(database: AuthzDatabase): EventingAuthzReadRepository {
    return new EventingAuthzReadRepository(database);
  }

  private constructor(private readonly database: AuthzDatabase) {
    super();
  }

  beginPass(): AuthzReadRepository {
    return this;
  }

  // Arrow instance properties, matching the base class's property-typed
  // abstract members (AuthzReadRepository declares them that way for test
  // mocks).
  /** Membership is not a grant: the same query the legacy repository runs. */
  findOrganizationMembership = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null> => {
    const row = (await this.database.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true, disabledAt: true },
    })) as { role: OrganizationRole; disabledAt: unknown } | null;
    if (!row) return null;
    return { role: row.role, disabled: row.disabledAt !== null };
  };

  findUserBindings = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    // Current organization membership, not the grant row, is the tenancy
    // boundary: a grant naming a user who has left the organization confers
    // nothing. `Grant` has no relation to `User` by design, so the gate the
    // legacy query expressed as a relation filter is a membership read here.
    if (!(await this.isCurrentMember({ userId, organizationId }))) return [];
    const rows = (await liveGrants(this.database).findMany({
      where: {
        organizationId,
        principalType: "USER",
        principalId: userId,
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: { roleKey: true, scopeType: true, scopeId: true },
    })) as BindingGrantRow[];
    return this.collectBindings({ rows, viaGroupId: () => null });
  };

  findGroupBindings = async ({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    // Same two-part gate the legacy group query carries: a GroupMembership row
    // outlives removal from the organization, so the group member must be a
    // CURRENT member, and the group itself must belong to this organization.
    if (!(await this.isCurrentMember({ userId, organizationId }))) return [];
    const memberships = (await this.database.groupMembership.findMany({
      where: { userId, group: { organizationId } },
      select: { groupId: true },
    })) as { groupId: string }[];
    if (memberships.length === 0) return [];
    // One read for every group, not one per group: the grant carries the group
    // it names, which is the `viaGroupId` the collector needs stamped on each
    // binding.
    const rows = (await liveGrants(this.database).findMany({
      where: {
        organizationId,
        principalType: "GROUP",
        principalId: { in: memberships.map((row) => row.groupId) },
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: {
        roleKey: true,
        scopeType: true,
        scopeId: true,
        principalId: true,
      },
    })) as (BindingGrantRow & { principalId: string })[];
    return this.collectBindings({
      rows,
      viaGroupId: (row) => row.principalId,
    });
  };

  findApiKeyBindings = async ({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> => {
    // No membership gate, for the reason the legacy repository gives: a key has
    // no OrganizationUser row of its own, and its owner's standing enters as
    // the §9 ceiling, computed elsewhere.
    const rows = (await liveGrants(this.database).findMany({
      where: {
        organizationId,
        principalType: "API_KEY",
        principalId: apiKeyId,
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: { roleKey: true, scopeType: true, scopeId: true },
    })) as BindingGrantRow[];
    return this.collectBindings({ rows, viaGroupId: () => null });
  };

  // Role head fenced on organization (poisoned grants) and API key (private roles).
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
    const rows = (await liveRoles(this.database).findMany({
      where: {
        id: { in: [...customRoleIds] },
        organizationId,
        // A user, a group, or an anonymous caller may never carry a key's
        // private role at all; an API key may carry its own, checked below.
        ...this.roleKindFence(apiKeyId),
      },
      select: { id: true, permissions: true, kind: true },
    })) as { id: string; permissions: unknown; kind: string }[];
    const systemRoleIds = rows
      .filter((row) => row.kind === SYSTEM_API_KEY_ROLE_KIND)
      .map((row) => row.id);
    if (systemRoleIds.length === 0 || apiKeyId === null) {
      return rows.map(({ id, permissions }) => ({ id, permissions }));
    }
    const exclusive = await this.rolesExclusiveToApiKey({
      organizationId,
      apiKeyId,
      roleIds: systemRoleIds,
    });
    return rows
      .filter((row) => row.kind !== SYSTEM_API_KEY_ROLE_KIND || exclusive.has(row.id))
      .map(({ id, permissions }) => ({ id, permissions }));
  };

  /** Membership again, not a grant: the legacy query, unchanged. */
  findApiKeyOwner = async (apiKeyId: string): Promise<{ userId: string | null } | null> => {
    return (await this.database.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    })) as { userId: string | null } | null;
  };

  // Share links as RESOURCE grants with token possession in WHERE; organizationId optional.
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

    const rows = await this.findResourceGrantCandidates({
      organizationId: resolvedOrganizationId,
      projectId,
      tokens,
      links,
    });
    if (rows.length === 0) return [];

    const viewCounts = await this.findViewCounts({
      organizationId: resolvedOrganizationId,
      grantIds: rows.map((row) => row.id),
    });
    return rows.flatMap((row) => this.shareLinkRowFrom({ row, viewCounts }));
  };

  /** The RESOURCE grants a share-link check may match: possession (the
   *  presented tokens) AND one of the presented resource links. */
  private async findResourceGrantCandidates({
    organizationId,
    projectId,
    tokens,
    links,
  }: {
    organizationId: string;
    projectId: string;
    tokens: readonly string[];
    links: readonly { kind: ShareableResourceKind; id: string }[];
  }): Promise<ShareLinkGrantCandidateRow[]> {
    return (
      (await liveGrants(this.database).findMany({
        where: {
          organizationId,
          projectId,
          scopeType: "RESOURCE",
          token: { in: [...tokens] },
          OR: links.map((link) => ({
            resourceKind: RESOURCE_KIND_TO_DB[link.kind],
            scopeId: link.id,
          })),
        },
        select: {
          id: true,
          principalType: true,
          resourceKind: true,
          scopeId: true,
          projectId: true,
          expiresAt: true,
          maxViews: true,
        },
      })) as (Omit<ShareLinkGrantCandidateRow, "expiresAt"> & { expiresAt: unknown })[]
    ).map((row) => ({ ...row, expiresAt: findStoredInstant(row.expiresAt) }));
  }

  /** The view budget lives on its own table (decision 22); a resource with no
   *  usage row has been viewed zero times. The organization bounds the read:
   *  a grant-id LIST alone is only as tenant-scoped as its weakest entry, so
   *  the tenancy guard refuses it without the organization named. */
  private async findViewCounts({
    organizationId,
    grantIds,
  }: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<Map<string, number>> {
    const usages = (await this.database.grantUsage.findMany({
      where: { organizationId, grantId: { in: [...grantIds] } },
      select: { grantId: true, viewCount: true },
    })) as { grantId: string; viewCount: number }[];
    return new Map(usages.map((usage) => [usage.grantId, usage.viewCount]));
  }

  /** Lineage is not a grant: the legacy query, unchanged. */
  findProjectLineage = async ({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> => {
    const project = (await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    })) as { team: { id: string; organizationId: string } } | null;
    if (!project?.team) return null;
    return {
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  };

  /** Lineage is not a grant: the legacy query, unchanged. */
  findTeamOrganization = async ({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> => {
    const team = (await this.database.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    })) as { organizationId: string } | null;
    return team ?? null;
  };

  private async isCurrentMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.database.organizationUser.findFirst({
      // `disabledAt: null` is part of the predicate, not a refinement of it: a
      // seat-disabled membership confers no grants, exactly as a removed one
      // does. This is the ledger-head twin of the relation fence the legacy
      // repository puts on each binding query.
      where: { userId, organizationId, disabledAt: null },
      select: { userId: true },
    });
    return membership !== null;
  }

  /**
   * Role ids among `roleIds` this API key alone holds a grant for. `some`
   * matters as much as `every`: `every` is vacuously true over an empty
   * relation, so a system role with NO grants would be readable by any key.
   */
  private async rolesExclusiveToApiKey({
    organizationId,
    apiKeyId,
    roleIds,
  }: {
    organizationId: string;
    apiKeyId: string;
    roleIds: readonly string[];
  }): Promise<Set<string>> {
    const holders = (await liveGrants(this.database).findMany({
      where: {
        organizationId,
        roleKey: { in: roleIds.map((roleId) => `custom:${roleId}`) },
      },
      select: { roleKey: true, principalType: true, principalId: true },
    })) as {
      roleKey: string | null;
      principalType: string;
      principalId: string | null;
    }[];
    const held = new Map<string, { isMine: boolean; isForeign: boolean }>();
    for (const holder of holders) {
      const roleKey = this.bindingRoleKeyFrom(holder.roleKey);
      if (roleKey === null || !roleKey.startsWith("custom:")) continue;
      const customRoleId = roleKey.slice("custom:".length);
      const entry = held.get(customRoleId) ?? {
        isMine: false,
        isForeign: false,
      };
      if (holder.principalType === "API_KEY" && holder.principalId === apiKeyId) {
        entry.isMine = true;
      } else {
        entry.isForeign = true;
      }
      held.set(customRoleId, entry);
    }
    return new Set(
      [...held.entries()]
        .filter(([, entry]) => entry.isMine && !entry.isForeign)
        .map(([roleId]) => roleId),
    );
  }

  private roleKindFence(apiKeyId: string | null): Record<string, unknown> {
    if (apiKeyId === null) {
      return { kind: { not: SYSTEM_API_KEY_ROLE_KIND } };
    }
    return {};
  }

  /** Only the role keys a decision can represent. Dormant facts such as
   * lite-member stay migration data instead of becoming permissions. */
  private collectBindings<
    TRow extends { roleKey: string | null; scopeType: string; scopeId: string },
  >({
    rows,
    viaGroupId,
  }: {
    rows: readonly TRow[];
    viaGroupId: (row: TRow) => string | null;
  }): CollectedBinding[] {
    const bindings: CollectedBinding[] = [];
    for (const row of rows) {
      if (!this.isBindingScope(row.scopeType)) continue;
      const roleKey = this.bindingRoleKeyFrom(row.roleKey);
      if (roleKey === null) continue;
      bindings.push({
        roleKey,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        viaGroupId: viaGroupId(row),
      });
    }
    return bindings;
  }

  private bindingRoleKeyFrom(roleKey: string | null): BindingRoleKey | null {
    if (roleKey === "admin" || roleKey === "member" || roleKey === "viewer") return roleKey;
    if (roleKey?.startsWith("custom:") && roleKey.length > "custom:".length) {
      return `custom:${roleKey.slice("custom:".length)}`;
    }
    return null;
  }

  private isBindingScope(scopeType: string): scopeType is RoleBindingScopeType {
    return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
  }

  private shareLinkRowFrom({
    row,
    viewCounts,
  }: {
    row: ShareLinkGrantCandidateRow;
    viewCounts: Map<string, number>;
  }): ShareLinkRow[] {
    const visibility = SHARE_VISIBILITY_BY_PRINCIPAL_DB[row.principalType];
    if (!visibility) return [];
    if (row.resourceKind !== "TRACE" && row.resourceKind !== "THREAD") {
      return [];
    }
    if (row.projectId == null) return [];
    return [
      {
        resourceType: row.resourceKind,
        resourceId: row.scopeId,
        projectId: row.projectId,
        visibility,
        expiresAt: row.expiresAt,
        maxViews: row.maxViews,
        viewCount: viewCounts.get(row.id) ?? 0,
      },
    ];
  }
}

/** The columns `findResourceGrantCandidates` selects off `Grant`. */
type ShareLinkGrantCandidateRow = {
  id: string;
  principalType: string;
  resourceKind: string | null;
  scopeId: string;
  projectId: string | null;
  expiresAt: Instant | null;
  maxViews: number | null;
};

/** A nullable stored timestamp column, as the store hands it back. */
function findStoredInstant(value: unknown): Instant | null {
  return value instanceof Date ? fromDate(value) : null;
}
