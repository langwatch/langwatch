/**
 * ADR-092 — the Prisma implementation of AuthzReadRepository: every query
 * COLLECT runs, and nothing else. Policy (group expansion semantics, the
 * lenient custom-role parse, share-link liveness) lives in
 * @langwatch/authz-server's collector; this class returns stored facts.
 *
 * Constructed over a transaction handle too - the offboarding proof binds
 * one of these to the deleting transaction so the re-collect sees the
 * deletes (ADR-092 §10 step 7).
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz";
import type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationRole,
  ShareLinkRow,
} from "@langwatch/authz-server";
import type { Prisma } from "~/generated/prisma/client";
import { CUSTOM_ROLE_KIND } from "../../role/role-kind";

export class PrismaAuthzReadRepository implements AuthzReadRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async findOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const row = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  async findUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      // Current organization membership - not the binding row - is the
      // tenancy boundary: a binding naming a user who has left the
      // organization confers nothing. Same predicate the legacy resolvers
      // carry (rbac.ts checkPermissionFromBindings, role-binding-resolver.ts
      // collectBindingsForUser).
      where: {
        organizationId,
        userId,
        user: { orgMemberships: { some: { organizationId } } },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findGroupBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      // A GroupMembership row outlives removal from the organization, so the
      // group member carries the same current-membership gate as a direct
      // binding - without it an offboarded user keeps whatever their groups
      // granted.
      where: {
        organizationId,
        group: {
          members: {
            some: {
              userId,
              user: { orgMemberships: { some: { organizationId } } },
            },
          },
        },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
        groupId: true,
      },
    });
    return rows.map(({ groupId, ...row }) => ({ ...row, viaGroupId: groupId }));
  }

  async findApiKeyBindings({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: { organizationId, apiKeyId },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findLegacyTeamMemberships({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    const rows = await this.prisma.teamUser.findMany({
      // A stale cross-org TeamUser row must not confer access any more than a
      // stale RoleBinding: the team belongs to the organization AND the user
      // is a current member of it (legacy parity, rbac.ts's TeamUser
      // fallback).
      where: {
        userId,
        team: {
          organizationId,
          organization: { members: { some: { userId } } },
        },
      },
      select: {
        teamId: true,
        role: true,
        assignedRoleId: true,
        team: { select: { isPersonal: true } },
      },
    });
    return rows.map((row) => ({
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId ?? null,
      isPersonal: row.team.isPersonal,
    }));
  }

  /**
   * Defense in depth on two axes, both mirroring the legacy resolvers: the
   * lookup is fenced to the organization being checked, so a poisoned binding
   * pointing at another organization's role reads as a missing role; and an
   * API key's private permission role backs only that key's own bindings
   * (see systemRoleGuard below).
   */
  async findCustomRolePermissions({
    organizationId,
    principal,
    customRoleIds,
  }: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: [...customRoleIds] },
        organizationId,
        ...systemRoleGuard(principal),
      },
      select: { id: true, permissions: true },
    });
  }

  /**
   * `{ userId: null }` is a service key - it exists and has no owner, so the
   * §9 ceiling does not apply to it; `null` is a key that is not there at all.
   */
  async findApiKeyOwner(
    apiKeyId: string,
  ): Promise<{ userId: string | null } | null> {
    return this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    });
  }

  async findShareLinks({
    projectId,
    tokens,
    links,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkRow[]> {
    return this.prisma.shareLink.findMany({
      where: {
        projectId,
        token: { in: [...tokens] },
        OR: links.map((link) => ({
          resourceType:
            link.kind === "trace" ? ("TRACE" as const) : ("THREAD" as const),
          resourceId: link.id,
        })),
      },
      select: {
        resourceType: true,
        resourceId: true,
        projectId: true,
        visibility: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
      },
    });
  }

  async findProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    });
    if (!project?.team) return null;
    return {
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }

  async findTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team ?? null;
  }
}

/**
 * The `customRole` predicate that keeps an API key's private permission role
 * with the key it was minted for, mirroring the legacy resolver's guard
 * (src/server/rbac/role-binding-resolver.ts).
 *
 * A user, a group, or an anonymous caller may never carry one at all. An API
 * key may carry one, but only its own: a binding from key A to key B's system
 * role would otherwise hand B's permissions to A, since the collector reads
 * whatever role the binding names. "Its own" is the same exclusivity
 * `RoleRepository.isExclusiveToApiKey` uses - every binding on the role
 * belongs to this key, and no legacy assignment holds it.
 *
 * The `some` beside the `every` is what makes that exclusivity mean
 * something. Prisma's `every` is vacuously TRUE over an empty relation, so a
 * system role with NO bindings at all satisfies `every: { apiKeyId }` for
 * every key on the platform - the guard would have admitted any key that
 * named such a role. `some` demands at least one binding to THIS key, which
 * is the "minted for me" half of the claim.
 */
function systemRoleGuard(principal: AuthzPrincipalRef) {
  if (principal.type !== "apiKey") {
    return { kind: { not: CUSTOM_ROLE_KIND.SYSTEM_API_KEY } };
  }
  return {
    OR: [
      { kind: { not: CUSTOM_ROLE_KIND.SYSTEM_API_KEY } },
      {
        roleBindings: {
          some: { apiKeyId: principal.id },
          every: { apiKeyId: principal.id },
        },
        assignedUsers: { none: {} },
      },
    ],
  };
}
