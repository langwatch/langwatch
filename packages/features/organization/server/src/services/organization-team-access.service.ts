/**
 * Who can reach a team and its projects, read back for the access screen: every active team
 * with the people and groups bound to it, and every project under it with the bindings that
 * grant access — whether through the team or straight to the project.
 */
import type { AuthzAccessBinding, AuthzService } from "@langwatch/authz-contract";
import {
  listOrganizationTeamAccessInputSchema,
  type ListOrganizationTeamAccessInput,
  type OrganizationGroupMember,
  type OrganizationTeam,
  type OrganizationTeamAccess,
  type OrganizationTeamAccessMember,
  type OrganizationTeamAccessProject,
} from "@langwatch/organization-contract";
import type { GroupRepository } from "../repositories/group.repository.ts";
import type { TeamRepository } from "../repositories/team.repository.ts";
import { TEAM_ROLE_PRIORITY } from "../rules/team-membership-plan.rules.ts";

type OrganizationTeamAccessOptions = {
  authz: AuthzService;
  groups: GroupRepository;
  teams: TeamRepository;
};

export class OrganizationTeamAccessService {
  static create(deps: OrganizationTeamAccessOptions): OrganizationTeamAccessService {
    return new OrganizationTeamAccessService(deps);
  }

  private constructor(private readonly deps: OrganizationTeamAccessOptions) {}

  async listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]> {
    const parsed = listOrganizationTeamAccessInputSchema.parse(input);
    const teams = await this.deps.teams.listActive({
      organizationId: parsed.organizationId,
    });
    const teamIds = teams.map(({ id }) => id);
    const projectIds = parsed.projects.map(({ id }) => id);
    const [teamBindings, projectBindings] = await Promise.all([
      this.deps.authz.listScopeBindings({
        organizationId: parsed.organizationId,
        scopeType: "TEAM",
        scopeIds: teamIds,
      }),
      projectIds.length === 0
        ? Promise.resolve([])
        : this.deps.authz.listScopeBindings({
            organizationId: parsed.organizationId,
            scopeType: "PROJECT",
            scopeIds: projectIds,
          }),
    ]);
    const allBindings = [...teamBindings, ...projectBindings];
    const groupIds = [
      ...new Set(allBindings.flatMap((binding) => (binding.groupId ? [binding.groupId] : []))),
    ];
    const groupMembers = await this.deps.groups.listMembersForGroups({
      organizationId: parsed.organizationId,
      groupIds,
    });

    return teams.map((team) =>
      this.teamAccess({
        team,
        projects: parsed.projects.filter(({ teamId }) => teamId === team.id),
        teamBindings: teamBindings.filter(({ scopeId }) => scopeId === team.id),
        projectBindings,
        groupMembers,
      }),
    );
  }

  private teamAccess(input: {
    team: OrganizationTeam;
    projects: OrganizationTeamAccessProject[];
    teamBindings: AuthzAccessBinding[];
    projectBindings: AuthzAccessBinding[];
    groupMembers: Map<string, OrganizationGroupMember[]>;
  }): OrganizationTeamAccess {
    const projectIds = new Set(input.projects.map(({ id }) => id));
    const projectBindings = input.projectBindings.filter(({ scopeId }) => projectIds.has(scopeId));
    const groupBindings = input.teamBindings.filter(({ groupId }) => groupId);
    const directMembers = this.teamAccessMembers({
      teamBindings: input.teamBindings,
      groupBindings,
      groupMembers: input.groupMembers,
    });
    const teamBoundUserIds = new Set(
      directMembers.flatMap(({ userId }) => (userId ? [userId] : [])),
    );

    return {
      id: input.team.id,
      name: input.team.name,
      slug: input.team.slug,
      projects: input.projects,
      directMembers,
      projectOnlyAccess: this.projectOnlyAccess({
        projectBindings,
        projects: input.projects,
        teamBoundUserIds,
      }),
      projectAccess: this.projectAccess({
        projects: input.projects,
        projectBindings,
        teamBindings: input.teamBindings,
        groupBindings,
        groupMembers: input.groupMembers,
        directMembers,
        teamBoundUserIds,
      }),
    };
  }

  /**
   * Who the team names directly, plus the people its group bindings expand to. A person named
   * both ways is listed once, under the strongest role their group bindings carry.
   */
  private teamAccessMembers(input: {
    teamBindings: AuthzAccessBinding[];
    groupBindings: AuthzAccessBinding[];
    groupMembers: Map<string, OrganizationGroupMember[]>;
  }): OrganizationTeamAccessMember[] {
    const directUserBindings = input.teamBindings.filter(({ userId }) => userId);
    const directUserIds = new Set(
      directUserBindings.flatMap(({ userId }) => (userId ? [userId] : [])),
    );
    const seenExpandedUserIds = new Set<string>();
    const expandedGroupMembers = [...input.groupBindings]
      .sort((left, right) => TEAM_ROLE_PRIORITY[left.role] - TEAM_ROLE_PRIORITY[right.role])
      .flatMap((binding): OrganizationTeamAccessMember[] => {
        if (!binding.groupId) {
          return [];
        }

        return (input.groupMembers.get(binding.groupId) ?? []).flatMap((member) => {
          if (directUserIds.has(member.userId) || seenExpandedUserIds.has(member.userId)) {
            return [];
          }

          seenExpandedUserIds.add(member.userId);

          return [
            {
              bindingId: null,
              userId: member.userId,
              groupId: binding.groupId,
              viaGroupId: binding.groupId,
              viaGroupName: binding.group?.name ?? null,
              name: member.name ?? member.email ?? "Unknown",
              email: member.email,
              image: member.image,
              role: binding.role,
              customRoleId: binding.customRoleId,
              customRoleName: binding.customRole?.name ?? null,
            },
          ];
        });
      });

    return [
      ...directUserBindings.map((binding) => ({
        bindingId: binding.id,
        userId: binding.userId,
        groupId: null,
        viaGroupId: null,
        viaGroupName: null,
        name: binding.user?.name ?? binding.user?.email ?? binding.apiKey?.name ?? "Unknown",
        email: binding.user?.email ?? null,
        image: binding.user?.image ?? null,
        role: binding.role,
        customRoleId: binding.customRoleId,
        customRoleName: binding.customRole?.name ?? null,
      })),
      ...expandedGroupMembers,
    ].sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) {
        return byName;
      }

      const byEmail = (left.email ?? "").localeCompare(right.email ?? "");

      return byEmail !== 0 ? byEmail : (left.userId ?? "").localeCompare(right.userId ?? "");
    });
  }

  /** People who reach a project without reaching the team it belongs to. */
  private projectOnlyAccess(input: {
    projectBindings: AuthzAccessBinding[];
    projects: OrganizationTeamAccessProject[];
    teamBoundUserIds: Set<string>;
  }): OrganizationTeamAccess["projectOnlyAccess"] {
    const projectOnlyAccess = new Map<
      string,
      OrganizationTeamAccess["projectOnlyAccess"][number]
    >();
    for (const binding of input.projectBindings) {
      if (!binding.userId || input.teamBoundUserIds.has(binding.userId)) {
        continue;
      }

      const project = input.projects.find(({ id }) => id === binding.scopeId);
      if (!project) {
        continue;
      }

      const key = `${binding.userId}:${project.id}`;
      if (!projectOnlyAccess.has(key)) {
        projectOnlyAccess.set(key, {
          bindingId: binding.id,
          userId: binding.userId,
          name: binding.user?.name ?? binding.userId,
          email: binding.user?.email ?? null,
          image: binding.user?.image ?? null,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }

    return [...projectOnlyAccess.values()];
  }

  /** Per project: who inherits their access from the team, and who is bound to it directly. */
  private projectAccess(input: {
    projects: OrganizationTeamAccessProject[];
    projectBindings: AuthzAccessBinding[];
    teamBindings: AuthzAccessBinding[];
    groupBindings: AuthzAccessBinding[];
    groupMembers: Map<string, OrganizationGroupMember[]>;
    directMembers: OrganizationTeamAccessMember[];
    teamBoundUserIds: Set<string>;
  }): OrganizationTeamAccess["projectAccess"] {
    const projectAccess: OrganizationTeamAccess["projectAccess"] = {};
    const teamBoundGroupIds = new Set(
      input.groupBindings.flatMap(({ groupId }) => (groupId ? [groupId] : [])),
    );
    for (const project of input.projects) {
      const bindings = input.projectBindings.filter(({ scopeId }) => scopeId === project.id);
      const overriddenUserIds = new Set(bindings.flatMap(({ userId }) => (userId ? [userId] : [])));
      for (const binding of bindings) {
        if (!binding.groupId) {
          continue;
        }

        for (const member of input.groupMembers.get(binding.groupId) ?? []) {
          overriddenUserIds.add(member.userId);
        }
      }

      const inherited = input.directMembers
        .filter(({ userId }) => !userId || !overriddenUserIds.has(userId))
        .map(({ viaGroupId: _viaGroupId, ...member }) => ({
          ...member,
          source: "team" as const,
        }));
      const direct = bindings.map((binding) => {
        const teamBinding = input.teamBindings.find(
          (candidate) => candidate.userId && candidate.userId === binding.userId,
        );
        const inherits =
          (!!binding.userId && input.teamBoundUserIds.has(binding.userId)) ||
          (!!binding.groupId && teamBoundGroupIds.has(binding.groupId));

        return {
          bindingId: binding.id,
          userId: binding.userId,
          groupId: binding.groupId,
          viaGroupName: binding.groupId ? (binding.group?.name ?? null) : null,
          name: binding.user?.name ?? binding.group?.name ?? binding.apiKey?.name ?? "Unknown",
          email: binding.user?.email ?? null,
          image: binding.user?.image ?? null,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
          source: inherits ? ("override" as const) : ("direct" as const),
          ...(teamBinding ? { teamRole: teamBinding.role } : {}),
        };
      });
      projectAccess[project.id] = [...inherited, ...direct];
    }

    return projectAccess;
  }
}
