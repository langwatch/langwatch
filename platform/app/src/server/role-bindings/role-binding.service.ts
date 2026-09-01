import type { LedgerActor } from "@langwatch/actor";
import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  getOrganizationRolePermissions,
  getTeamRolePermissions,
} from "~/server/api/rbac";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerBindingAttach,
  ledgerPrincipal,
} from "~/server/app-layer/authz/ledger";
import { CutoverAwareAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.cutover.repository";
import type { AccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.repository";
// The SCIM-managed guard's typed refusal, shared with `group.service.ts` so
// both paths answer the customer with the same `scim_managed_group` code.
// These three used to throw a raw TRPCError whose `code` published as
// "BAD_REQUEST" and whose message was the whole contract, which meant the
// anchor in specs/groups/groups-rest-api.feature held on one path only.
import { ScimManagedGroupError } from "~/server/app-layer/groups/errors";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { LiteMemberViewerOnlyError } from "~/server/app-layer/teams/team.service";
import type { RoleService } from "~/server/role/role.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import { isBindingRoleAllowedForOrganizationRole } from "~/utils/memberRoleConstraints";
import {
  ApiKeyNotInOrganizationError,
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
  GroupNotInOrganizationError,
  RoleBindingAlreadyExistsError,
  RoleBindingNotFoundError,
  RoleBindingPrincipalInvalidError,
  UserNotInOrganizationError,
} from "./errors";
import { assertNoPersonalTeamScope } from "./personal-team-scope";

/**
 * The ledger reports an identical declaration as `DuplicateBindingError` (the
 * writer checks binding identity before it emits, so there is no P2002 to
 * sniff any more); the write paths map it to the deterministic conflict code
 * a provisioning tool can treat as "already done".
 *
 * Matched by CODE, never `instanceof`: the class arrives from
 * `@langwatch/authz-server`, and identity stops being reliable the moment
 * that package is bundled or serialised separately (the rule
 * `grant-validation.ts` states on the declaration itself).
 */
function isDuplicateBinding(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "role_binding_already_exists"
  );
}

type ScopeRows = {
  orgs: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; isPersonal: boolean }>;
  projects: Array<{
    id: string;
    name: string;
    isPersonal: boolean;
    team: { isPersonal: boolean };
  }>;
};

/**
 * The scope rows as the two list surfaces need them: a name per scope, and the
 * set of scopes that are somebody's personal workspace.
 *
 * Either flag is enough to call a project personal. The two are meant to agree,
 * and a reader that insisted on both would offer a half-migrated row as
 * manageable access, which is the one answer that is wrong either way.
 */
function foldScopeRows({ orgs, teams, projects }: ScopeRows): {
  scopeNames: Map<string, string>;
  personalScopeIds: Set<string>;
} {
  const scopeNames = new Map<string, string>();
  for (const scope of [...orgs, ...teams, ...projects]) {
    scopeNames.set(scope.id, scope.name);
  }

  const personalScopeIds = new Set<string>();
  for (const team of teams) {
    if (team.isPersonal) personalScopeIds.add(team.id);
  }
  for (const project of projects) {
    if (project.isPersonal || project.team.isPersonal) {
      personalScopeIds.add(project.id);
    }
  }

  return { scopeNames, personalScopeIds };
}

export class RoleBindingService {
  // TODO: complex queries (listForUser, listForOrg, etc.) should be moved to the repository
  private readonly prisma: PrismaClient;
  private readonly repo: RoleBindingRepository;
  private readonly roleService: RoleService;
  // Every binding write on this service is a grants-ledger command; the
  // RoleBinding table is a projection fed by the fold, never written here.
  private readonly writer: GrantsLedgerWriter;
  // Listing reads go through the per-organization fork: a cut-over
  // organization's Access pages are served from the ledger's own head, so
  // what people see and what the engine decides from can never be different
  // heads (ADR-092, delivery-plan PR 3 follow-up).
  private readonly accessListing: AccessListingRepository;

  constructor({
    prisma,
    repo,
    roleService,
    writer = grantsLedgerWriter(),
    accessListing = new CutoverAwareAccessListingRepository(prisma),
  }: {
    prisma: PrismaClient;
    repo: RoleBindingRepository;
    roleService: RoleService;
    writer?: GrantsLedgerWriter;
    accessListing?: AccessListingRepository;
  }) {
    this.prisma = prisma;
    this.repo = repo;
    this.roleService = roleService;
    this.writer = writer;
    this.accessListing = accessListing;
  }

  /**
   * Whether this user's access so far derives ONLY from legacy shared-team
   * membership: no explicit binding anywhere in the organization, but TeamUser
   * rows on shared teams. Creating their first binding switches that fallback
   * off (see `checkPermissionFromBindings` and the resolver's legacy ceiling),
   * so callers can say so before it happens.
   */
  async wouldFirstBindingDisableLegacyAccess({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const [bindingCount, legacyCount] = await Promise.all([
      this.prisma.roleBinding.count({ where: { organizationId, userId } }),
      this.prisma.teamUser.count({
        where: { userId, team: { organizationId, isPersonal: false } },
      }),
    ]);
    return bindingCount === 0 && legacyCount > 0;
  }

  /**
   * Validates the role side of a batch of binding writes, in order: a CUSTOM
   * role needs its id, the custom roles must be assignable in this
   * organization, and none of them may carry an organization-exclusive
   * permission below organization scope.
   */
  private async validateBindingRoles({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
    }>;
  }) {
    for (const b of bindings) {
      if (b.role === TeamUserRole.CUSTOM && !b.customRoleId) {
        throw new CustomRoleIdRequiredError();
      }
    }

    const customBindings = bindings.filter(
      (b): b is typeof b & { customRoleId: string } =>
        b.role === TeamUserRole.CUSTOM && !!b.customRoleId,
    );
    if (customBindings.length === 0) return;

    await this.assertCustomRolesAssignable({
      organizationId,
      customRoleIds: [...new Set(customBindings.map((b) => b.customRoleId))],
    });
    await this.roleService.assertNoOrgExclusivePermissionsBelowOrgScope({
      organizationId,
      customBindings,
    });
  }

  /**
   * Every one of these custom roles must be assignable in this organization:
   * its own, user-created ones.
   */
  private async assertCustomRolesAssignable({
    organizationId,
    customRoleIds,
  }: {
    organizationId: string;
    customRoleIds: string[];
  }): Promise<void> {
    const assignable = new Set(
      await this.roleService.filterAssignableRoleIds({
        roleIds: customRoleIds,
        organizationId,
      }),
    );
    const notAssignable = customRoleIds.find((id) => !assignable.has(id));
    if (notAssignable) {
      throw new CustomRoleNotAssignableError(notAssignable);
    }
  }

  /** The user id belongs to a member of this organization, or the write stops. */
  private async assertUserInOrganization({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const count = await this.prisma.organizationUser.count({
      where: { organizationId, userId },
    });
    if (count === 0) {
      throw new UserNotInOrganizationError(userId);
    }
  }

  /**
   * Besides confirming the principal belongs to the organization, this
   * returns a user's organization role, because what may be written for them
   * depends on their seat. A group principal has no seat, so its role is null.
   */
  private async validatePrincipalInOrganization({
    organizationId,
    userId,
    groupId,
    apiKeyId,
  }: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    apiKeyId?: string;
  }): Promise<{ organizationRole: OrganizationUserRole | null }> {
    if (userId) {
      // The membership row is read rather than counted because the caller
      // needs the seat it names: a Lite Member's bindings are ceilinged by it.
      const membership = await this.prisma.organizationUser.findFirst({
        where: { organizationId, userId },
        select: { role: true },
      });
      if (!membership) {
        throw new UserNotInOrganizationError(userId);
      }
      return { organizationRole: membership.role };
    }
    if (groupId) {
      const group = await this.prisma.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true },
      });
      if (!group) {
        throw new GroupNotInOrganizationError(groupId);
      }
    }
    if (apiKeyId) {
      const apiKey = await this.prisma.apiKey.findFirst({
        where: { id: apiKeyId, organizationId },
        select: { id: true },
      });
      if (!apiKey) {
        throw new ApiKeyNotInOrganizationError(apiKeyId);
      }
    }
    return { organizationRole: null };
  }

  /**
   * A Lite Member seat means viewing only, and the stored access says so too.
   * A direct row above Viewer, a custom role (its permissions are its own, so
   * holding one requires a full seat), or any organization-scoped row is
   * refused rather than stored and capped at resolution — the seat ceiling is
   * enforced when access is written, the same way `updateTeamMemberRole`
   * enforces it. Group bindings are never checked here: a group has no seat,
   * and what the seat does to group-granted access is decided at resolution.
   */
  private async assertRowsWithinLiteMemberSeat({
    organizationRole,
    organizationId,
    bindings,
  }: {
    /** Null when the principal is a group — a group has no seat. */
    organizationRole: OrganizationUserRole | null;
    organizationId: string;
    bindings: Array<{
      role: TeamUserRole;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
  }): Promise<void> {
    if (organizationRole !== OrganizationUserRole.EXTERNAL) return;

    const offending = bindings.find(
      (b) =>
        b.scopeType === RoleBindingScopeType.ORGANIZATION ||
        !isBindingRoleAllowedForOrganizationRole({
          organizationRole,
          role: b.role,
        }),
    );
    if (!offending) return;

    const { scopeNames } = await this.resolveScopes({
      bindings: [offending],
      organizationId,
    });
    throw new LiteMemberViewerOnlyError(
      scopeNames.get(offending.scopeId) ?? null,
    );
  }

  /**
   * The display name of every scope these bindings name, and which of those
   * scopes are somebody's personal workspace.
   *
   * A personal workspace is not access an administrator granted or can take
   * away: it is provisioned with the member, holds only them, and every write
   * against it is refused (see `assertNoPersonalTeamScope`). So the two lists
   * an administrator manages access from leave it out, rather than putting a
   * row on the members page for every member of the organization with a control
   * behind it that cannot succeed. What a member may do inside their own
   * workspace follows from their organization role, which those pages already
   * show. `getMyAccessBreakdown` is a member reading their own access rather
   * than a management surface, so it keeps listing it.
   *
   * Scope lookups stay filtered by organization as defense in depth against a
   * stray binding whose scopeId points outside it (historical data, failed
   * migrations), even though the bindings are already filtered by it.
   */
  private async resolveScopes({
    bindings,
    organizationId,
  }: {
    bindings: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
    organizationId: string;
  }): Promise<{
    scopeNames: Map<string, string>;
    personalScopeIds: Set<string>;
  }> {
    return foldScopeRows(
      await this.findScopeRows({ bindings, organizationId }),
    );
  }

  /** The scoped rows these bindings point at, one query per scope type. */
  private async findScopeRows({
    bindings,
    organizationId,
  }: {
    bindings: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
    organizationId: string;
  }): Promise<ScopeRows> {
    const idsOfType = (scopeType: RoleBindingScopeType) =>
      bindings.filter((b) => b.scopeType === scopeType).map((b) => b.scopeId);

    const orgIds = idsOfType(RoleBindingScopeType.ORGANIZATION);
    const teamIds = idsOfType(RoleBindingScopeType.TEAM);
    const projectIds = idsOfType(RoleBindingScopeType.PROJECT);

    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({
            where: { id: { in: orgIds.filter((id) => id === organizationId) } },
            select: { id: true, name: true },
          })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds }, organizationId },
            select: { id: true, name: true, isPersonal: true },
          })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds }, team: { organizationId } },
            select: {
              id: true,
              name: true,
              isPersonal: true,
              team: { select: { isPersonal: true } },
            },
          })
        : [],
    ]);

    return { orgs, teams, projects };
  }

  async listForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }) {
    const bindings = await this.accessListing.findUserBindings({
      organizationId,
      userId,
    });

    const { scopeNames, personalScopeIds } = await this.resolveScopes({
      bindings,
      organizationId,
    });

    return bindings
      .filter((b) => !personalScopeIds.has(b.scopeId))
      .map((b) => ({
        id: b.id,
        userId: b.userId,
        role: b.role,
        customRoleId: b.customRoleId,
        customRoleName: b.customRole?.name ?? null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
        scopeName: scopeNames.get(b.scopeId) ?? null,
        createdAt: b.createdAt,
      }));
  }

  async listForOrg({ organizationId }: { organizationId: string }) {
    const bindings = await this.accessListing.findOrganizationBindings({
      organizationId,
    });

    const { scopeNames, personalScopeIds } = await this.resolveScopes({
      bindings,
      organizationId,
    });
    const manageable = bindings.filter((b) => !personalScopeIds.has(b.scopeId));

    const groupIds = manageable
      .filter((b) => b.groupId != null)
      .map((b) => b.groupId!);
    const groupMemberships =
      groupIds.length > 0
        ? await this.prisma.groupMembership.findMany({
            where: {
              groupId: { in: groupIds },
              group: { organizationId },
              user: { orgMemberships: { some: { organizationId } } },
            },
            select: { groupId: true, userId: true },
          })
        : [];
    const membersByGroup = new Map<string, string[]>();
    for (const m of groupMemberships) {
      if (!membersByGroup.has(m.groupId)) membersByGroup.set(m.groupId, []);
      membersByGroup.get(m.groupId)!.push(m.userId);
    }
    const memberUserIdsFor = (groupId: string | null): string[] =>
      groupId ? (membersByGroup.get(groupId) ?? []) : [];

    return manageable.map((b) => ({
      id: b.id,
      userId: b.userId,
      userName: b.user?.name ?? null,
      userEmail: b.user?.email ?? null,
      userImage: b.user?.image ?? null,
      groupId: b.groupId,
      groupName: b.group?.name ?? null,
      groupScimSource: b.group?.scimSource ?? null,
      apiKeyId: b.apiKeyId,
      apiKeyName: b.apiKey?.name ?? null,
      role: b.role,
      customRoleId: b.customRoleId,
      customRoleName: b.customRole?.name ?? null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: scopeNames.get(b.scopeId) ?? null,
      memberUserIds: memberUserIdsFor(b.groupId),
      createdAt: b.createdAt,
    }));
  }

  async getMyAccessBreakdown({
    organizationId,
    userId,
    userName,
    userEmail,
  }: {
    organizationId: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
  }) {
    const [orgMember, groupMemberships] = await Promise.all([
      this.prisma.organizationUser.findFirst({
        where: { userId, organizationId },
        select: { role: true },
      }),
      this.prisma.groupMembership.findMany({
        where: { userId, group: { organizationId } },
        include: {
          group: {
            select: { id: true, name: true, slug: true, scimSource: true },
          },
        },
      }),
    ]);

    const groupIds = groupMemberships.map((gm) => gm.groupId);

    const allBindings = await this.accessListing.findUserAndGroupBindings({
      organizationId,
      userId,
      groupIds,
    });

    const orgScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION)
      .map((b) => b.scopeId);
    const teamScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.TEAM)
      .map((b) => b.scopeId);
    const projectScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.PROJECT)
      .map((b) => b.scopeId);

    const [orgs, teams, projects] = await Promise.all([
      orgScopeIds.length > 0
        ? this.prisma.organization.findMany({
            where: { id: organizationId },
            select: { id: true, name: true },
          })
        : [],
      teamScopeIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: [...new Set(teamScopeIds)] }, organizationId },
            select: { id: true, name: true },
          })
        : [],
      projectScopeIds.length > 0
        ? this.prisma.project.findMany({
            where: {
              id: { in: [...new Set(projectScopeIds)] },
              team: { organizationId },
            },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const scopeNames = new Map<string, string>();
    for (const o of orgs) scopeNames.set(o.id, o.name);
    for (const t of teams) scopeNames.set(t.id, t.name);
    for (const p of projects) scopeNames.set(p.id, p.name);

    const resolvePermissions = (
      binding: (typeof allBindings)[number],
    ): string[] => {
      if (binding.role === TeamUserRole.CUSTOM && binding.customRole) {
        const perms = binding.customRole.permissions;
        return Array.isArray(perms)
          ? perms.filter((p): p is string => typeof p === "string")
          : [];
      }
      if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
        if (binding.role === TeamUserRole.ADMIN) {
          return getOrganizationRolePermissions(OrganizationUserRole.ADMIN);
        }
        if (binding.role === TeamUserRole.MEMBER) {
          return getOrganizationRolePermissions(OrganizationUserRole.MEMBER);
        }
        // VIEWER or CUSTOM (with no resolvable customRole) at the ORG scope:
        // fall back to the minimal EXTERNAL permission set rather than silently
        // elevating to MEMBER. Today nothing writes these bindings, but this
        // prevents accidental promotion if that ever changes.
        return getOrganizationRolePermissions(OrganizationUserRole.EXTERNAL);
      }
      return getTeamRolePermissions(binding.role);
    };

    const toBindingSummary = (b: (typeof allBindings)[number]) => ({
      id: b.id,
      role: b.role as string,
      customRoleName: b.customRole?.name ?? null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: scopeNames.get(b.scopeId) ?? null,
      permissions: resolvePermissions(b),
    });

    const directBindings = allBindings
      .filter((b) => b.userId === userId)
      .map(toBindingSummary);

    const groupBindingsByGroupId = new Map<
      string,
      (typeof allBindings)[number][]
    >();
    for (const b of allBindings.filter((b) => b.groupId != null)) {
      const gid = b.groupId!;
      if (!groupBindingsByGroupId.has(gid)) groupBindingsByGroupId.set(gid, []);
      groupBindingsByGroupId.get(gid)!.push(b);
    }

    // The router gates this on `organization:view`, so `orgMember` is always
    // present in practice. The fallback is defensive only.
    const orgRole = orgMember?.role ?? OrganizationUserRole.MEMBER;

    return {
      user: {
        id: userId,
        name: userName,
        email: userEmail,
        orgRole: orgRole as string,
        orgRolePermissions: getOrganizationRolePermissions(orgRole),
      },
      groups: groupMemberships.map((gm) => ({
        id: gm.group.id,
        name: gm.group.name,
        slug: gm.group.slug,
        scimSource: gm.group.scimSource,
        bindings: (groupBindingsByGroupId.get(gm.groupId) ?? []).map(
          toBindingSummary,
        ),
      })),
      directBindings,
    };
  }

  async create({
    organizationId,
    userId,
    groupId,
    apiKeyId,
    role,
    customRoleId,
    scopeType,
    scopeId,
    actor,
  }: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    apiKeyId?: string;
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
    actor: LedgerActor;
  }): Promise<{ id: string }> {
    const principals = [userId, groupId, apiKeyId].filter(
      (principal) => principal != null && principal !== "",
    );
    if (principals.length !== 1) {
      throw new RoleBindingPrincipalInvalidError();
    }

    await this.repo.validateScopeInOrg({ organizationId, scopeType, scopeId });
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: [{ scopeType, scopeId }],
    });
    const { organizationRole } = await this.validatePrincipalInOrganization({
      organizationId,
      userId,
      groupId,
      apiKeyId,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: [{ role, customRoleId, scopeType }],
    });
    await this.assertRowsWithinLiteMemberSeat({
      organizationRole,
      organizationId,
      bindings: [{ role, scopeType, scopeId }],
    });

    const bindingId = generate(KSUID_RESOURCES.ROLE_BINDING).toString();
    try {
      await this.writer.attachBindings({
        organizationId,
        bindings: [
          {
            bindingId,
            principal: ledgerPrincipal({ userId, groupId, apiKeyId }),
            role,
            customRoleId:
              role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
            scopeType,
            scopeId,
          },
        ],
        actor,
        onDuplicate: "reject",
      });
    } catch (error) {
      if (isDuplicateBinding(error)) {
        throw new RoleBindingAlreadyExistsError({
          meta: { scopeType, scopeId },
        });
      }
      throw error;
    }
    // The command's own identity, not a row read: the fact is durable the
    // moment the append lands, while the projection row follows the fold.
    return { id: bindingId };
  }

  async update({
    organizationId,
    bindingId,
    role,
    customRoleId,
    actor,
  }: {
    organizationId: string;
    bindingId: string;
    role: TeamUserRole;
    customRoleId?: string;
    actor: LedgerActor;
  }): Promise<{ id: string }> {
    const binding = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!binding) {
      throw new RoleBindingNotFoundError(bindingId);
    }
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: [binding] });
    await this.validateBindingRoles({
      organizationId,
      bindings: [{ role, customRoleId, scopeType: binding.scopeType }],
    });
    if (binding.userId) {
      const membership = await this.prisma.organizationUser.findFirst({
        where: { organizationId, userId: binding.userId },
        select: { role: true },
      });
      // A row can outlive its member (historical data); with nobody on a seat
      // there is no ceiling to hold the edit against.
      if (membership) {
        await this.assertRowsWithinLiteMemberSeat({
          organizationRole: membership.role,
          organizationId,
          bindings: [
            { role, scopeType: binding.scopeType, scopeId: binding.scopeId },
          ],
        });
      }
    }
    try {
      await this.writer.changeBindingRole({
        organizationId,
        bindingId,
        role,
        customRoleId:
          role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
        actor,
      });
    } catch (error) {
      if (isDuplicateBinding(error)) {
        throw new RoleBindingAlreadyExistsError({
          meta: { scopeType: binding.scopeType, scopeId: binding.scopeId },
        });
      }
      throw error;
    }
    return { id: bindingId };
  }

  async delete({
    organizationId,
    bindingId,
    actor,
  }: {
    organizationId: string;
    bindingId: string;
    actor: LedgerActor;
  }) {
    const binding = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!binding) {
      throw new RoleBindingNotFoundError(bindingId);
    }
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: [binding] });
    await this.writer.revokeBindings({
      organizationId,
      bindingIds: [bindingId],
      actor,
    });
    return { success: true };
  }

  /**
   * Apply a batch of binding deletes + creates for a single user. Used by
   * MemberDetailDialog. The whole batch is validated before anything is
   * emitted, so a bad input writes nothing; the revoke goes first, so a crash
   * between the two commands leaves the member with less access than asked
   * for, never more, and the retry attaches cleanly (the ledger's fail-safe
   * ordering, replacing the transaction the imperative writer used).
   */
  async applyMemberBindings({
    organizationId,
    userId,
    bindingIdsToDelete,
    bindingsToCreate,
    actor,
  }: {
    organizationId: string;
    userId: string;
    bindingIdsToDelete: string[];
    bindingsToCreate: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    actor: LedgerActor;
  }) {
    // Validate scopes and role assignability up front so a bad input fails
    // the whole batch before anything is emitted. There is no transaction to
    // open any more — the bindings are ledger commands — so this pre-flight
    // is the only thing standing between a bad row and a half-applied batch.
    const { organizationRole } = await this.validatePrincipalInOrganization({
      organizationId,
      userId,
    });
    for (const b of bindingsToCreate) {
      await this.repo.validateScopeInOrg({
        organizationId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      });
    }
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: bindingsToCreate,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: bindingsToCreate,
    });
    // The dialog applies the seat before this batch, so the ceiling is held
    // against the seat the member is on by the time the rows would be written.
    await this.assertRowsWithinLiteMemberSeat({
      organizationRole,
      organizationId,
      bindings: bindingsToCreate,
    });

    if (bindingIdsToDelete.length > 0) {
      await this.revokeMemberBindings({
        organizationId,
        userId,
        bindingIdsToDelete,
        actor,
      });
    }

    if (bindingsToCreate.length > 0) {
      await this.attachMemberBindings({
        organizationId,
        userId,
        bindingsToCreate,
        actor,
      });
    }

    return { success: true };
  }

  /**
   * Revokes exactly these bindings: every id must exist in the organization,
   * and none may point at a personal workspace.
   */
  private async revokeMemberBindings({
    organizationId,
    userId,
    bindingIdsToDelete,
    actor,
  }: {
    organizationId: string;
    userId: string;
    bindingIdsToDelete: string[];
    actor: LedgerActor;
  }): Promise<void> {
    // The batch describes the state the admin wants this member's access to be
    // in, so an id that no longer exists is already in that state: a seat
    // change applied just before this batch rewrites the member's team rows,
    // and a row another admin removed concurrently is equally gone. Only the
    // member's own direct rows are deletable through their edit, so an id
    // resolving to another principal is skipped rather than deleted.
    const existing = await this.prisma.roleBinding.findMany({
      where: {
        id: { in: bindingIdsToDelete },
        organizationId,
        userId,
        groupId: null,
      },
      select: { id: true, scopeType: true, scopeId: true },
    });
    if (existing.length === 0) return;

    await assertNoPersonalTeamScope({ client: this.prisma, scopes: existing });
    await this.writer.revokeBindings({
      organizationId,
      bindingIds: existing.map((binding) => binding.id),
      actor,
    });
  }

  /**
   * Attaches the user's new bindings.
   *
   * Re-asserting a row the member already holds (or staging the same row
   * twice) is a duplicate the writer skips; skipping it leaves exactly the
   * state the admin asked for, which is what this batch means.
   */
  private async attachMemberBindings({
    organizationId,
    userId,
    bindingsToCreate,
    actor,
  }: {
    organizationId: string;
    userId: string;
    bindingsToCreate: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    actor: LedgerActor;
  }): Promise<void> {
    await this.writer.attachBindings({
      organizationId,
      bindings: bindingsToCreate.map((b) => ({
        bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        principal: { userId },
        role: b.role,
        customRoleId:
          b.role === TeamUserRole.CUSTOM ? (b.customRoleId ?? null) : null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      })),
      actor,
      onDuplicate: "skip",
    });
  }

  /**
   * Apply a batch of edits to a group: rename, binding additions/removals,
   * and member additions/removals. The rename and the membership rows are
   * not grant facts, so they keep their transaction; the binding writes are
   * commands emitted after it commits (revoke first, then attach — the
   * fail-safe order).
   */
  async applyGroupEdits({
    organizationId,
    groupId,
    rename,
    bindingIdsToDelete,
    bindingsToCreate,
    memberUserIdsToAdd,
    memberUserIdsToRemove,
    actor,
  }: {
    organizationId: string;
    groupId: string;
    rename?: { name: string; slug: string } | null;
    bindingIdsToDelete: string[];
    bindingsToCreate: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
    actor: LedgerActor;
  }) {
    for (const b of bindingsToCreate) {
      await this.repo.validateScopeInOrg({
        organizationId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      });
    }
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: bindingsToCreate,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: bindingsToCreate,
    });

    // Resolve the group's own bindings this edit orphans BEFORE touching
    // membership, and revoke them first. A crash between the revoke and the
    // membership edit then leaves strictly less access than asked for, never
    // more, and a retry converges — the same fail-safe ordering
    // applyMemberBindings uses for a single member's direct rows.
    const bindingIdsToRevoke = await this.resolveGroupBindingIdsToRevoke({
      organizationId,
      groupId,
      bindingIdsToDelete,
    });

    if (bindingIdsToRevoke.length > 0) {
      await this.writer.revokeBindings({
        organizationId,
        bindingIds: bindingIdsToRevoke,
        actor,
      });
    }

    await this.applyGroupMembershipEdits({
      organizationId,
      groupId,
      rename,
      memberUserIdsToAdd,
      memberUserIdsToRemove,
    });

    if (bindingsToCreate.length > 0) {
      await this.writer.attachBindings({
        organizationId,
        bindings: bindingsToCreate.map(
          (b): LedgerBindingAttach => ({
            bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            principal: { groupId },
            role: b.role,
            customRoleId:
              b.role === TeamUserRole.CUSTOM ? (b.customRoleId ?? null) : null,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          }),
        ),
        actor,
        onDuplicate: "skip",
      });
    }

    return { success: true };
  }

  /**
   * Which of the group's own bindings this edit orphans: the explicitly
   * requested deletes, resolved to their current rows. Same desired-state
   * rule as applyMemberBindings — an id another admin already removed is
   * already in the state this edit asks for, and an id resolving to a
   * different group's row is skipped, never deleted. Runs before the
   * membership transaction (and before the writer.revokeBindings command
   * that follows it) so a crash after the revoke leaves less access than
   * asked for, never more.
   */
  private async resolveGroupBindingIdsToRevoke({
    organizationId,
    groupId,
    bindingIdsToDelete,
  }: {
    organizationId: string;
    groupId: string;
    bindingIdsToDelete: string[];
  }): Promise<string[]> {
    if (bindingIdsToDelete.length === 0) return [];
    const existing = await this.prisma.roleBinding.findMany({
      where: {
        id: { in: bindingIdsToDelete },
        organizationId,
        groupId,
      },
      select: { id: true, scopeType: true, scopeId: true },
    });
    if (existing.length === 0) return [];
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: existing });
    return existing.map((b) => b.id);
  }

  /**
   * The half of a group edit that is not a grant fact — the rename and the
   * membership rows — in one transaction. Nothing here writes a binding: the
   * binding revoke this edit implies runs before this is called, so a crash
   * mid-edit never leaves an orphaned binding live.
   */
  private async applyGroupMembershipEdits({
    organizationId,
    groupId,
    rename,
    memberUserIdsToAdd,
    memberUserIdsToRemove,
  }: {
    organizationId: string;
    groupId: string;
    rename?: { name: string; slug: string } | null;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true, scimSource: true },
      });
      if (!group) {
        throw new GroupNotInOrganizationError(groupId);
      }

      if (rename) {
        if (group.scimSource) {
          throw new ScimManagedGroupError(groupId);
        }
        await tx.group.update({
          where: { id: groupId },
          data: { name: rename.name, slug: rename.slug },
        });
      }

      if (memberUserIdsToRemove.length > 0) {
        if (group.scimSource) {
          throw new ScimManagedGroupError(groupId);
        }
        await tx.groupMembership.deleteMany({
          where: { groupId, userId: { in: memberUserIdsToRemove } },
        });
      }

      if (memberUserIdsToAdd.length > 0) {
        if (group.scimSource) {
          throw new ScimManagedGroupError(groupId);
        }
        const uniqueMemberIds = [...new Set(memberUserIdsToAdd)];
        const orgMembers = await tx.organizationUser.findMany({
          where: {
            organizationId,
            userId: { in: uniqueMemberIds },
          },
          select: { userId: true },
        });
        if (orgMembers.length !== uniqueMemberIds.length) {
          const found = new Set(orgMembers.map((member) => member.userId));
          const missing =
            uniqueMemberIds.find((id) => !found.has(id)) ?? "unknown";
          throw new UserNotInOrganizationError(missing);
        }
        await tx.groupMembership.createMany({
          data: uniqueMemberIds.map((userId) => ({ groupId, userId })),
          skipDuplicates: true,
        });
      }
    });
  }
}
