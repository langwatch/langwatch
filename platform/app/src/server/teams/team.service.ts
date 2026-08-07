import { NotFoundError } from "@langwatch/handled-error";
import {
  Prisma,
  type PrismaClient,
  type Project,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import type {
  RoleBindingRepository,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import {
  CannotRemoveSelfAsLastAdminError,
  PersonalWorkspaceNotManagedHereError,
  TeamLastAdminRequiredError,
} from "~/server/app-layer/teams/team.service";

// When a user holds multiple bindings on one team, the most privileged is the
// one the settings page displays (and the binding team.update edits).
export const TEAM_ROLE_PRIORITY: Record<TeamUserRole, number> = {
  [TeamUserRole.ADMIN]: 0,
  [TeamUserRole.MEMBER]: 1,
  [TeamUserRole.VIEWER]: 2,
  [TeamUserRole.CUSTOM]: 3,
};

/** The user fields every team-member projection selects (kept in one place so
 * the shape can't drift across the three role-binding include sites). */
const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const satisfies Prisma.UserSelect;

/** The principal relations every RoleBinding projection on this page loads
 * (team-level and project-level read the same shape). */
const PRINCIPAL_BINDING_INCLUDE = {
  user: { select: MEMBER_USER_SELECT },
  group: { select: { id: true, name: true, scimSource: true } },
  apiKey: { select: { id: true, name: true } },
  customRole: { select: { id: true, name: true } },
} as const satisfies Prisma.RoleBindingInclude;

type PrincipalBinding = Prisma.RoleBindingGetPayload<{
  include: typeof PRINCIPAL_BINDING_INCLUDE;
}>;

const GROUP_MEMBERSHIP_INCLUDE = {
  user: { select: MEMBER_USER_SELECT },
} as const satisfies Prisma.GroupMembershipInclude;

type GroupMembershipWithUser = Prisma.GroupMembershipGetPayload<{
  include: typeof GROUP_MEMBERSHIP_INCLUDE;
}>;

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

// Ascending, nulls last — matches Postgres `ORDER BY col ASC` (the ordering the
// previous Prisma `orderBy` produced before members were resolved in memory).
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

type TxClient = Prisma.TransactionClient;

async function computeEffectiveAdminUserIds(
  tx: TxClient,
  organizationId: string,
  teamId: string,
): Promise<Set<string>> {
  const adminBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
    },
    select: { userId: true, groupId: true },
  });

  const userIds = new Set<string>();
  const groupIds: string[] = [];
  for (const b of adminBindings) {
    if (b.userId) userIds.add(b.userId);
    if (b.groupId) groupIds.push(b.groupId);
  }

  if (groupIds.length > 0) {
    const memberships = await tx.groupMembership.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true },
    });
    for (const m of memberships) userIds.add(m.userId);
  }

  return userIds;
}

async function isUserAdminViaGroup({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<boolean> {
  const adminGroupBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
      groupId: { not: null },
    },
    select: { groupId: true },
  });
  if (adminGroupBindings.length === 0) return false;

  const count = await tx.groupMembership.count({
    where: {
      userId,
      groupId: { in: adminGroupBindings.map((b) => b.groupId!) },
    },
  });
  return count > 0;
}

type RemovableTeam = {
  id: string;
  name: string;
  organizationId: string;
  isPersonal: boolean;
};

async function loadRemovableTeam({
  tx,
  teamId,
}: {
  tx: TxClient;
  teamId: string;
}): Promise<RemovableTeam> {
  // Validate that the team exists
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      isPersonal: true,
    },
  });

  if (!team) {
    throw new NotFoundError("team_not_found", "Team", teamId);
  }

  // The one member of a personal team is its owner, and the last-admin
  // projection below stops protecting them the moment a group binding
  // exists on the team, so the invariant is stated here directly.
  if (team.isPersonal) {
    throw new PersonalWorkspaceNotManagedHereError(team.name);
  }

  return team;
}

async function requireDirectTeamBinding({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<void> {
  // Check if the target user is currently a direct member of the team
  const targetBinding = await tx.roleBinding.findFirst({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      userId,
    },
    select: { role: true },
  });

  if (!targetBinding) {
    throw new NotFoundError("team_membership_not_found", "TeamMember", userId);
  }
}

async function assertRemovalKeepsAnAdmin({
  tx,
  team,
  teamId,
  userId,
  currentUserId,
  effectiveAdminUserIds,
}: {
  tx: TxClient;
  team: RemovableTeam;
  teamId: string;
  userId: string;
  currentUserId: string;
  effectiveAdminUserIds: Set<string>;
}): Promise<void> {
  // Project the post-removal admin set. Removing the target's direct
  // binding only changes things if they aren't also an admin via a
  // group membership on this team.
  const targetStillAdminViaGroup = await isUserAdminViaGroup({
    tx,
    organizationId: team.organizationId,
    teamId,
    userId,
  });
  const projectedAdminUserIds = new Set(effectiveAdminUserIds);
  if (!targetStillAdminViaGroup) {
    projectedAdminUserIds.delete(userId);
  }

  if (projectedAdminUserIds.size === 0) {
    if (userId === currentUserId) {
      throw new CannotRemoveSelfAsLastAdminError(team.name);
    }

    throw new TeamLastAdminRequiredError(team.name);
  }
}

// Remove RoleBinding and legacy TeamUser row (if any) atomically
async function deleteTeamMembership({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<void> {
  await Promise.all([
    tx.roleBinding.deleteMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    }),
    tx.teamUser.deleteMany({
      where: { userId, teamId },
    }),
  ]);
}

type TeamMemberEntry = {
  bindingId: string | null;
  userId: string | null;
  groupId: string | null;
  viaGroupId: string | null;
  viaGroupName: string | null;
  name: string;
  email: string | null;
  image: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
};

type ProjectOnlyAccessEntry = {
  bindingId: string;
  userId: string;
  name: string;
  email: string | null;
  image: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
  projectId: string;
  projectName: string;
};

type ProjectAccessEntry = {
  bindingId: string | null;
  userId: string | null;
  groupId: string | null;
  viaGroupName: string | null;
  name: string;
  email: string | null;
  image: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
  source: "team" | "direct" | "override";
  teamRole?: TeamUserRole;
};

const toDirectMemberEntry = (binding: PrincipalBinding): TeamMemberEntry => ({
  bindingId: binding.id as string | null,
  userId: binding.userId,
  groupId: null as string | null,
  viaGroupId: null as string | null,
  viaGroupName: null as string | null,
  name:
    binding.user?.name ??
    binding.user?.email ??
    binding.apiKey?.name ??
    "Unknown",
  email: binding.user?.email ?? null,
  image: binding.user?.image ?? null,
  role: binding.role,
  customRoleId: binding.customRoleId,
  customRoleName: binding.customRole?.name ?? null,
});

const toExpandedGroupMemberEntry = ({
  binding,
  membership,
}: {
  binding: PrincipalBinding;
  membership: GroupMembershipWithUser;
}): TeamMemberEntry => ({
  bindingId: null as string | null,
  userId: membership.userId,
  groupId: binding.groupId,
  viaGroupId: binding.groupId!,
  viaGroupName: binding.group?.name ?? null,
  name: membership.user.name ?? membership.user.email ?? "Unknown",
  email: membership.user.email ?? null,
  image: membership.user.image ?? null,
  role: binding.role,
  customRoleId: binding.customRoleId,
  customRoleName: binding.customRole?.name ?? null,
});

const expandGroupMembers = ({
  groupBindings,
  groupMemberships,
  directUserIds,
}: {
  groupBindings: PrincipalBinding[];
  groupMemberships: GroupMembershipWithUser[];
  directUserIds: Set<string>;
}): TeamMemberEntry[] => {
  // When a user belongs to multiple team-bound groups, keep only the
  // highest-privilege entry. Order: ADMIN > MEMBER > VIEWER > CUSTOM.
  const sortedGroupBindings = [...groupBindings].sort(
    (a, b) => TEAM_ROLE_PRIORITY[a.role] - TEAM_ROLE_PRIORITY[b.role],
  );

  const seenExpandedUserIds = new Set<string>();
  return sortedGroupBindings.flatMap((binding) =>
    groupMemberships
      .filter((gm) => gm.groupId === binding.groupId)
      .filter((gm) => {
        if (directUserIds.has(gm.userId)) return false; // direct binding takes priority
        if (seenExpandedUserIds.has(gm.userId)) return false;
        seenExpandedUserIds.add(gm.userId);
        return true;
      })
      .map((membership) => toExpandedGroupMemberEntry({ binding, membership })),
  );
};

const compareByNameEmailUserId = (
  a: TeamMemberEntry,
  b: TeamMemberEntry,
): number => {
  const nameCmp = (a.name ?? "").localeCompare(b.name ?? "");
  if (nameCmp !== 0) return nameCmp;
  const emailCmp = (a.email ?? "").localeCompare(b.email ?? "");
  if (emailCmp !== 0) return emailCmp;
  return (a.userId ?? "").localeCompare(b.userId ?? "");
};

/** Direct users bound to the team, plus the members of every group bound to
 * it, collapsed to one entry per user. */
const buildDirectMembers = ({
  teamBindings,
  groupBindings,
  groupMemberships,
}: {
  teamBindings: PrincipalBinding[];
  groupBindings: PrincipalBinding[];
  groupMemberships: GroupMembershipWithUser[];
}): TeamMemberEntry[] => {
  const directUserBindings = teamBindings.filter((b) => b.userId);
  const directUserIds = new Set(directUserBindings.map((b) => b.userId!));

  const expandedGroupMembers = expandGroupMembers({
    groupBindings,
    groupMemberships,
    directUserIds,
  });

  return [
    ...directUserBindings.map(toDirectMemberEntry),
    ...expandedGroupMembers,
  ].sort(compareByNameEmailUserId);
};

const toProjectOnlyAccessEntry = ({
  binding,
  userId,
  project,
}: {
  binding: PrincipalBinding;
  userId: string;
  project: Pick<Project, "id" | "name">;
}): ProjectOnlyAccessEntry => ({
  bindingId: binding.id,
  userId,
  name: binding.user?.name ?? userId,
  email: binding.user?.email ?? null,
  image: binding.user?.image ?? null,
  role: binding.role,
  customRoleId: binding.customRoleId,
  customRoleName: binding.customRole?.name ?? null,
  projectId: project.id,
  projectName: project.name,
});

/** Users with project bindings but NO team binding. */
const buildProjectOnlyAccess = ({
  projectBindings,
  projects,
  teamBoundUserIds,
}: {
  projectBindings: PrincipalBinding[];
  projects: Pick<Project, "id" | "name">[];
  teamBoundUserIds: Set<string>;
}): ProjectOnlyAccessEntry[] => {
  const projectOnlyMap = new Map<string, ProjectOnlyAccessEntry>();

  for (const binding of projectBindings) {
    const { userId } = binding;
    if (!userId) continue;
    if (teamBoundUserIds.has(userId)) continue;
    const project = projects.find((p) => p.id === binding.scopeId);
    if (!project) continue;
    const key = `${userId}:${binding.scopeId}`;
    if (projectOnlyMap.has(key)) continue;
    projectOnlyMap.set(
      key,
      toProjectOnlyAccessEntry({ binding, userId, project }),
    );
  }

  return [...projectOnlyMap.values()];
};

const toInheritedProjectAccessEntry = (
  member: TeamMemberEntry,
): ProjectAccessEntry => ({
  bindingId: member.bindingId,
  userId: member.userId,
  groupId: member.groupId,
  viaGroupName: member.viaGroupName,
  name: member.name,
  email: member.email,
  image: member.image,
  role: member.role,
  customRoleId: member.customRoleId,
  customRoleName: member.customRoleName,
  source: "team" as const,
});

// A binding "overrides" team access if the same principal (user or group)
// already has team-level access — direct or group-expanded for users; same
// group bound at team level for groups.
const bindingInheritsFromTeam = ({
  binding,
  teamBoundUserIds,
  teamBoundGroupIds,
}: {
  binding: PrincipalBinding;
  teamBoundUserIds: Set<string>;
  teamBoundGroupIds: Set<string>;
}): boolean => {
  const userInheritsFromTeam =
    !!binding.userId && teamBoundUserIds.has(binding.userId);
  const groupInheritsFromTeam =
    !!binding.groupId && teamBoundGroupIds.has(binding.groupId);
  return userInheritsFromTeam || groupInheritsFromTeam;
};

const toProjectLevelAccessEntry = ({
  binding,
  teamBindings,
  teamBoundUserIds,
  teamBoundGroupIds,
}: {
  binding: PrincipalBinding;
  teamBindings: PrincipalBinding[];
  teamBoundUserIds: Set<string>;
  teamBoundGroupIds: Set<string>;
}): ProjectAccessEntry => {
  const directTeamBinding = teamBindings.find(
    (tb) => tb.userId && tb.userId === binding.userId,
  );
  const inheritsFromTeam = bindingInheritsFromTeam({
    binding,
    teamBoundUserIds,
    teamBoundGroupIds,
  });
  return {
    bindingId: binding.id,
    userId: binding.userId,
    groupId: binding.groupId,
    viaGroupName: binding.groupId ? (binding.group?.name ?? null) : null,
    name:
      binding.user?.name ??
      binding.group?.name ??
      binding.apiKey?.name ??
      "Unknown",
    email: binding.user?.email ?? null,
    image: binding.user?.image ?? null,
    role: binding.role,
    customRoleId: binding.customRoleId,
    customRoleName: binding.customRole?.name ?? null,
    source: inheritsFromTeam ? ("override" as const) : ("direct" as const),
    teamRole: directTeamBinding?.role,
  };
};

// Project-level group bindings also override the inherited (team-level)
// group-expanded entries for their members.
const collectOverriddenUserIds = ({
  projBindings,
  groupMemberships,
}: {
  projBindings: PrincipalBinding[];
  groupMemberships: GroupMembershipWithUser[];
}): Set<string> => {
  const overriddenUserIds = new Set<string>(
    projBindings.filter((b) => b.userId).map((b) => b.userId!),
  );
  const projGroupIdsOnThisProject = projBindings
    .filter((b) => b.groupId)
    .map((b) => b.groupId!);
  for (const gid of projGroupIdsOnThisProject) {
    for (const gm of groupMemberships) {
      if (gm.groupId === gid) overriddenUserIds.add(gm.userId);
    }
  }
  return overriddenUserIds;
};

const buildProjectAccessForProject = ({
  projectId,
  directMembers,
  teamBindings,
  projectBindings,
  teamBoundUserIds,
  teamBoundGroupIds,
  groupMemberships,
}: {
  projectId: string;
  directMembers: TeamMemberEntry[];
  teamBindings: PrincipalBinding[];
  projectBindings: PrincipalBinding[];
  teamBoundUserIds: Set<string>;
  teamBoundGroupIds: Set<string>;
  groupMemberships: GroupMembershipWithUser[];
}): ProjectAccessEntry[] => {
  const inherited = directMembers.map(toInheritedProjectAccessEntry);

  const projBindings = projectBindings.filter((b) => b.scopeId === projectId);

  const projectLevel = projBindings.map((binding) =>
    toProjectLevelAccessEntry({
      binding,
      teamBindings,
      teamBoundUserIds,
      teamBoundGroupIds,
    }),
  );

  // Remove "inherited" entries that have a project-level override.
  const overriddenUserIds = collectOverriddenUserIds({
    projBindings,
    groupMemberships,
  });
  const filteredInherited = inherited.filter(
    (m) => !m.userId || !overriddenUserIds.has(m.userId),
  );

  return [...filteredInherited, ...projectLevel];
};

const buildProjectAccess = ({
  projects,
  directMembers,
  teamBindings,
  projectBindings,
  groupBindings,
  groupMemberships,
  teamBoundUserIds,
}: {
  projects: Pick<Project, "id">[];
  directMembers: TeamMemberEntry[];
  teamBindings: PrincipalBinding[];
  projectBindings: PrincipalBinding[];
  groupBindings: PrincipalBinding[];
  groupMemberships: GroupMembershipWithUser[];
  teamBoundUserIds: Set<string>;
}): Record<string, ProjectAccessEntry[]> => {
  // Group IDs bound at the team level — used to detect whether a
  // project-level group binding is overriding a team-level one.
  const teamBoundGroupIds = new Set(groupBindings.map((b) => b.groupId!));

  const projectAccess: Record<string, ProjectAccessEntry[]> = {};
  for (const proj of projects) {
    projectAccess[proj.id] = buildProjectAccessForProject({
      projectId: proj.id,
      directMembers,
      teamBindings,
      projectBindings,
      teamBoundUserIds,
      teamBoundGroupIds,
      groupMemberships,
    });
  }
  return projectAccess;
};

export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    // Constructed once and reused across reads; the default keeps existing
    // `new TeamService(prisma)` call sites working while allowing injection.
    private readonly roleBindingRepo: RoleBindingRepository = new PrismaRoleBindingRepository(
      prisma,
    ),
  ) {}

  /**
   * Shape TEAM-scoped RoleBindings into the legacy `team.members` (TeamUser)
   * form so callers render members the same way regardless of when membership
   * was created.
   *
   * RoleBindings are the authoritative membership source since migration
   * 20260407120000_migrate_team_users_to_role_bindings (which backfilled
   * existing TeamUser rows and stopped dual-writing to them). Reading the
   * legacy TeamUser relation omitted anyone added after the migration.
   *
   * A user can hold more than one TEAM binding on the same team (the partial
   * unique indexes allow a built-in role plus a custom role at one scope), so
   * we collapse to one row per user keeping the highest-privilege binding —
   * the settings page renders (and its save mutation keys) one row per user.
   */
  private shapeTeamMembers(
    bindings: TeamScopedMemberBinding[],
    teamId: string,
  ) {
    const byUser = new Map<string, TeamScopedMemberBinding>();
    for (const binding of bindings) {
      const existing = byUser.get(binding.userId);
      if (
        !existing ||
        TEAM_ROLE_PRIORITY[binding.role] < TEAM_ROLE_PRIORITY[existing.role]
      ) {
        byUser.set(binding.userId, binding);
      }
    }

    return [...byUser.values()]
      .map((binding) => ({
        userId: binding.userId,
        teamId,
        role: binding.role,
        assignedRoleId: binding.customRoleId,
        assignedRole: binding.customRole,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: binding.user,
      }))
      .sort((a, b) => {
        const nameCmp = compareNullsLast(a.user.name, b.user.name);
        if (nameCmp !== 0) return nameCmp;
        const emailCmp = compareNullsLast(a.user.email, b.user.email);
        if (emailCmp !== 0) return emailCmp;
        return a.userId.localeCompare(b.userId);
      });
  }

  /**
   * A single team (by slug) plus its projects and members, for the
   * team-settings page. Returns `null` when no team matches; the caller maps
   * null to NOT_FOUND and applies email-privacy redaction (request-scoped).
   */
  async getTeamWithMembers({
    slug,
    organizationId,
  }: {
    slug: string;
    organizationId: string;
  }) {
    const team = await this.prisma.team.findFirst({
      where: { slug, organizationId },
      include: {
        projects: {
          where: {
            archivedAt: null,
            kind: { not: "internal_governance" },
          },
        },
      },
    });

    if (!team) return null;

    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: [team.id],
      });

    return {
      ...team,
      members: this.shapeTeamMembers(byTeam.get(team.id) ?? [], team.id),
    };
  }

  /**
   * All non-archived teams in an org, each with projects + members, for member
   * pickers / drawers / onboarding. `callerHasManage` controls the personal-
   * workspace privacy floor (non-admins never see others' personal teams).
   * Email redaction stays in the caller since it's request-scoped.
   */
  async getTeamsWithMembers({
    organizationId,
    callerId,
    callerHasManage,
  }: {
    organizationId: string;
    callerId: string;
    callerHasManage: boolean;
  }) {
    const teams = await this.prisma.team.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(callerHasManage
          ? {}
          : {
              OR: [
                { isPersonal: false },
                { isPersonal: true, ownerUserId: callerId },
              ],
            }),
      },
      include: {
        projects: {
          where: {
            archivedAt: null,
            kind: { not: "internal_governance" },
          },
        },
      },
    });

    // Single binding query for all teams (no N+1), grouped by teamId.
    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: teams.map((team) => team.id),
      });

    return teams.map((team) => ({
      ...team,
      members: this.shapeTeamMembers(byTeam.get(team.id) ?? [], team.id),
    }));
  }

  /**
   * A team looked up by slug, returned only if the user is a direct member —
   * membership resolved from TEAM-scoped RoleBindings (not the legacy TeamUser
   * relation, which post-migration members are absent from). Returns `null`
   * when the team doesn't exist or the user isn't a member.
   */
  async getTeamBySlugForUser({
    slug,
    organizationId,
    userId,
  }: {
    slug: string;
    organizationId: string;
    userId: string;
  }) {
    const team = await this.prisma.team.findFirst({
      where: { slug, organizationId },
    });

    if (!team) return null;

    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: [team.id],
      });

    const isMember = (byTeam.get(team.id) ?? []).some(
      (binding) => binding.userId === userId,
    );
    return isMember ? team : null;
  }

  async getTeamsWithRoleBindings({
    organizationId,
  }: {
    organizationId: string;
  }) {
    const teams = await this.prisma.team.findMany({
      where: { organizationId, archivedAt: null },
      include: {
        projects: { where: { archivedAt: null }, orderBy: { name: "asc" } },
      },
      orderBy: { name: "asc" },
    });

    const results = await Promise.all(
      teams.map((team) =>
        this.buildTeamRoleBindingsView({ team, organizationId }),
      ),
    );

    return results;
  }

  private async buildTeamRoleBindingsView({
    team,
    organizationId,
  }: {
    team: { id: string; name: string; slug: string; projects: Project[] };
    organizationId: string;
  }) {
    const projectIds = team.projects.map((p) => p.id);

    // ── Fetch all RoleBindings touching this team (team-level + project-level) ──
    const [teamBindings, projectBindings] =
      await this.fetchPrincipalBindingsForTeam({
        organizationId,
        teamId: team.id,
        projectIds,
      });

    // ── Expand group memberships for every group referenced by any
    // binding touching this team. We fetch memberships for project-level
    // group bindings too because they're needed to decide which inherited
    // (team-level group-expanded) entries to filter out as overridden on
    // each project. ──
    const groupBindings = teamBindings.filter((b) => b.groupId);
    const projectGroupBindings = projectBindings.filter((b) => b.groupId);
    const allGroupIds = Array.from(
      new Set([
        ...groupBindings.map((b) => b.groupId!),
        ...projectGroupBindings.map((b) => b.groupId!),
      ]),
    );
    const groupMemberships = await this.fetchGroupMemberships({
      organizationId,
      groupIds: allGroupIds,
    });

    // ── Build directMembers: direct users + expanded group members ──
    const directMembers = buildDirectMembers({
      teamBindings,
      groupBindings,
      groupMemberships,
    });

    // ── Collect userIds that have a team-level binding (direct or via group) ──
    const teamBoundUserIds = new Set(
      directMembers.filter((m) => m.userId).map((m) => m.userId!),
    );

    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      projects: team.projects,
      directMembers,
      projectOnlyAccess: buildProjectOnlyAccess({
        projectBindings,
        projects: team.projects,
        teamBoundUserIds,
      }),
      projectAccess: buildProjectAccess({
        projects: team.projects,
        directMembers,
        teamBindings,
        projectBindings,
        groupBindings,
        groupMemberships,
        teamBoundUserIds,
      }),
    };
  }

  private fetchPrincipalBindingsForTeam({
    organizationId,
    teamId,
    projectIds,
  }: {
    organizationId: string;
    teamId: string;
    projectIds: string[];
  }): Promise<[PrincipalBinding[], PrincipalBinding[]]> {
    return Promise.all([
      this.prisma.roleBinding.findMany({
        where: {
          organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
          ...principalInOrganizationWhere(organizationId),
        },
        include: PRINCIPAL_BINDING_INCLUDE,
      }),
      projectIds.length > 0
        ? this.prisma.roleBinding.findMany({
            where: {
              organizationId,
              scopeType: RoleBindingScopeType.PROJECT,
              scopeId: { in: projectIds },
              ...principalInOrganizationWhere(organizationId),
            },
            include: PRINCIPAL_BINDING_INCLUDE,
          })
        : [],
    ]);
  }

  private fetchGroupMemberships({
    organizationId,
    groupIds,
  }: {
    organizationId: string;
    groupIds: string[];
  }): Promise<GroupMembershipWithUser[]> {
    if (groupIds.length === 0) return Promise.resolve([]);

    return this.prisma.groupMembership.findMany({
      where: {
        groupId: { in: groupIds },
        group: { organizationId },
        user: { orgMemberships: { some: { organizationId } } },
      },
      include: GROUP_MEMBERSHIP_INCLUDE,
    });
  }

  async removeMember({
    teamId,
    userId,
    currentUserId,
  }: {
    teamId: string;
    userId: string;
    currentUserId: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const team = await loadRemovableTeam({ tx, teamId });

        // Compute the effective set of admin userIds — direct user ADMIN
        // bindings plus members of any group with an ADMIN binding on this
        // team. Counting only direct user bindings (as we used to) ignores
        // SCIM/group admins and would incorrectly treat a team with a single
        // direct admin + group-expanded admins as having only one admin.
        const effectiveAdminUserIds = await computeEffectiveAdminUserIds(
          tx,
          team.organizationId,
          teamId,
        );

        if (effectiveAdminUserIds.size === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }

        await requireDirectTeamBinding({
          tx,
          organizationId: team.organizationId,
          teamId,
          userId,
        });

        await assertRemovalKeepsAnAdmin({
          tx,
          team,
          teamId,
          userId,
          currentUserId,
          effectiveAdminUserIds,
        });

        await deleteTeamMembership({
          tx,
          organizationId: team.organizationId,
          teamId,
          userId,
        });

        // Post-removal validation: ensure we still have at least one
        // effective admin (direct or group-expanded).
        const finalAdminUserIds = await computeEffectiveAdminUserIds(
          tx,
          team.organizationId,
          teamId,
        );

        if (finalAdminUserIds.size === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }

        return {
          success: true,
          removedUserId: userId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
