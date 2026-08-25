/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's legacy reader.
 *
 * These are the queries the settings pages ran inline before the port existed
 * (`RoleBindingService`, `TeamService`, the role-binding repository, the group
 * and API-key repositories), moved here so the per-org fork has a legacy side
 * to delegate to. The WHERE predicates carry over unchanged, with one
 * exception: the group listing gained the organization bound it never had.
 * The row shapes did not - they were consolidated onto one row type and one
 * decoration include, so three reads differ from their inline originals. The
 * API-key read joins where it selected five scalars, `listForOrg`'s role
 * select gained `permissions`, and the synthesis read drops the `group` key
 * it only ever used to filter on.
 *
 * Deliberately independent of `access-listing.grants.repository.ts`, for the
 * same reason the decision readers are: the two answer the same questions of
 * different tables, and each has to be readable on its own for a listing
 * parity check to mean anything.
 */
import type {
  CustomRole,
  Prisma,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import type {
  RoleBindingForSynthesis,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { CUSTOM_ROLE_KIND } from "../../../role/role-kind";
import type {
  AccessListingBindingRow,
  AccessListingRepository,
} from "./access-listing.repository";
import {
  ACCESS_LISTING_API_KEY_SELECT,
  ACCESS_LISTING_CUSTOM_ROLE_SELECT,
  ACCESS_LISTING_GROUP_SELECT,
  ACCESS_LISTING_USER_SELECT,
} from "./access-listing.repository";
import { LIVE_MEMBERSHIP } from "./live-rows";

/** The relation predicate the whole-table and scope listings carry: a row is
 *  listed only while its principal is still of this organization. */
const principalInOrganizationWhere = (
  organizationId: string,
): Prisma.RoleBindingWhereInput => ({
  OR: [
    {
      userId: { not: null },
      user: { orgMemberships: { some: { organizationId } } },
    },
    { groupId: { not: null }, group: { organizationId } },
    { apiKeyId: { not: null }, apiKey: { organizationId } },
  ],
});

const DECORATION_INCLUDE = {
  user: { select: ACCESS_LISTING_USER_SELECT },
  group: { select: ACCESS_LISTING_GROUP_SELECT },
  apiKey: { select: ACCESS_LISTING_API_KEY_SELECT },
  customRole: { select: ACCESS_LISTING_CUSTOM_ROLE_SELECT },
} as const satisfies Prisma.RoleBindingInclude;

type DecoratedRoleBinding = Prisma.RoleBindingGetPayload<{
  include: typeof DECORATION_INCLUDE;
}>;

function toRow(binding: DecoratedRoleBinding): AccessListingBindingRow {
  return {
    id: binding.id,
    organizationId: binding.organizationId,
    userId: binding.userId,
    groupId: binding.groupId,
    apiKeyId: binding.apiKeyId,
    role: binding.role,
    customRoleId: binding.customRoleId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    createdAt: binding.createdAt,
    // `RoleBinding` has no expiry column. An organization on this head
    // cannot hold an expiring binding either - the ledger writer refuses to
    // create one where it could not be stored - so null is the whole truth
    // here, not a gap.
    expiresAt: null,
    user: binding.user,
    group: binding.group,
    apiKey: binding.apiKey,
    customRole: binding.customRole,
  };
}

export class PrismaAccessListingRepository implements AccessListingRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async findUserBindings({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AccessListingBindingRow[]> {
    const bindings = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return bindings.map(toRow);
  }

  async findOrganizationBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessListingBindingRow[]> {
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        ...principalInOrganizationWhere(organizationId),
      },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return bindings.map(toRow);
  }

  async findUserAndGroupBindings({
    organizationId,
    userId,
    groupIds,
  }: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        OR: [
          { userId },
          ...(groupIds.length > 0 ? [{ groupId: { in: [...groupIds] } }] : []),
        ],
      },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return bindings.map(toRow);
  }

  async findScopeBindings({
    organizationId,
    scopeType,
    scopeIds,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
    if (scopeIds.length === 0) return [];
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType,
        scopeId: { in: [...scopeIds] },
        ...principalInOrganizationWhere(organizationId),
      },
      include: DECORATION_INCLUDE,
    });
    return bindings.map(toRow);
  }

  async findGroupBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]> {
    const bindings = await this.prisma.roleBinding.findMany({
      where: { organizationId, groupId },
      include: DECORATION_INCLUDE,
    });
    return bindings.map(toRow);
  }

  async findTeamMemberBindings({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    // Pre-seed every requested teamId so the caller can rely on a hit even
    // for teams with no members, and so a single query covers all teams.
    const byTeam = new Map<string, TeamScopedMemberBinding[]>(
      teamIds.map((teamId) => [teamId, []]),
    );
    if (teamIds.length === 0) return byTeam;

    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: "TEAM",
        scopeId: { in: [...teamIds] },
        userId: { not: null },
        user: { orgMemberships: { some: { organizationId } } },
      },
      include: { user: true, customRole: true },
    });

    for (const binding of bindings) {
      // The query filters userId non-null and includes user, but Prisma's
      // types don't narrow — skip defensively rather than assert, so a future
      // change to the where/include can't silently produce undefined fields.
      if (!binding.userId || !binding.user) continue;
      byTeam.get(binding.scopeId)?.push({
        userId: binding.userId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: binding.user,
        customRole: binding.customRole,
      });
    }

    return byTeam;
  }

  async findBindingsForSynthesis({
    orgIds,
    userId,
  }: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    if (orgIds.length === 0) return [];
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId: { in: [...orgIds] },
        OR: [
          { userId },
          // LIVE_MEMBERSHIP, not a bare `{ userId }`: a removal marks the
          // membership row, so without the fence a group somebody LEFT still
          // synthesizes its bindings onto them.
          { group: { members: { some: { userId, ...LIVE_MEMBERSHIP } } } },
        ],
        scopeType: { in: ["TEAM", "ORGANIZATION", "PROJECT"] },
      },
      select: {
        organizationId: true,
        scopeType: true,
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: true,
            organizationId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        group: { select: { organizationId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return bindings
      .filter(
        (binding) =>
          !binding.group ||
          binding.group.organizationId === binding.organizationId,
      )
      .map(({ group: _group, ...binding }) => binding);
  }

  async findUserCreatedRoles({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CustomRole[]> {
    return this.prisma.customRole.findMany({
      where: { organizationId, kind: CUSTOM_ROLE_KIND.CUSTOM },
      orderBy: { createdAt: "desc" },
    });
  }
}
