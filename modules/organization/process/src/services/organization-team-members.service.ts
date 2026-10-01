/**
 * A team's people: add/remove, create/update, read back with members
 * attached. Every write goes through the authz grants ledger; a change
 * leaving a team with no administrator is refused before it is written.
 */
import type { AuthzAccessBinding, AuthzApi, AuthzGrantCaller } from "@langwatch/authz-contract";
import {
  CannotRemoveSelfAsLastAdminError,
  PersonalTeamProtectedError,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  TeamCustomRoleNotAssignableError,
  TeamCustomRoleRequiredError,
  TeamLastAdminRequiredError,
  TeamNotFoundError,
  PersonalWorkspaceNotManagedHereError,
  TeamMembershipNotFoundError,
  addOrganizationTeamMemberInputSchema,
  changeOrganizationTeamMemberInputSchema,
  createOrganizationTeamWithMembersInputSchema,
  getOrganizationTeamWithMembersInputSchema,
  listOrganizationTeamsWithMembersInputSchema,
  updateOrganizationTeamWithMembersInputSchema,
  type AddOrganizationTeamMemberInput,
  type CreateOrganizationTeamInput,
  type CreateOrganizationTeamWithMembersInput,
  type GetOrganizationTeamWithMembersInput,
  type ListOrganizationTeamsWithMembersInput,
  type OrganizationLedgerActor,
  type OrganizationTeam,
  type OrganizationTeamMemberInput,
  type OrganizationTeamWithMembers,
  type RemoveOrganizationTeamMemberInput,
  type UpdateOrganizationTeamWithMembersInput,
} from "@langwatch/organization-contract";
import { fromDate } from "@langwatch/time";

import type { TeamIdentity } from "../app/organization.members.ts";
import type { GroupRepository } from "../repositories/group.repository.ts";
import type { TeamRepository } from "../repositories/team.repository.ts";
import {
  directAdminIdsAfterPlan,
  memberTarget,
  planTeamMembership,
  shapeTeamMembers,
  type TeamMembershipPlan,
} from "../rules/team-membership-plan.rules.ts";
import {
  OrganizationGrantCeilingService,
  type OrganizationIntendedGrant,
} from "./organization-grant-ceiling.service.ts";

type OrganizationTeamMembersOptions = {
  authz: AuthzApi;
  grants: AuthzApi;
  groups: GroupRepository;
  teams: TeamRepository;
  teamIdentities: TeamIdentity;
  /** The owning service's own team creation, so a team created with members is created once. */
  createTeam: (input: CreateOrganizationTeamInput) => Promise<OrganizationTeam>;
};

export class OrganizationTeamMembersService {
  static create(deps: OrganizationTeamMembersOptions): OrganizationTeamMembersService {
    return new OrganizationTeamMembersService(deps);
  }

  private constructor(private readonly deps: OrganizationTeamMembersOptions) {}

  async addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    const parsed = addOrganizationTeamMemberInputSchema.parse(input);
    const team = await this.deps.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }

    await this.deps.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: [parsed.userId],
    });
    await this.deps.grants.attachBindings({
      organizationId: parsed.organizationId,
      bindings: [
        {
          bindingId: this.deps.teamIdentities.createBindingId(),
          principal: { userId: parsed.userId },
          role: parsed.role,
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: parsed.teamId,
        },
      ],
      caller: parsed.caller,
      actor: parsed.actor,
      onDuplicate: "attach",
    });
  }

  async removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void> {
    const parsed = changeOrganizationTeamMemberInputSchema.parse(input);
    const team = await this.deps.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }

    await this.deps.teams.fenceMembershipChange({
      teamId: team.id,
      organizationId: team.organizationId,
      expectedUpdatedAt: fromDate(team.updatedAt),
      removeLegacyUserId: parsed.userId,
      change: async () => {
        const bindings = await this.teamBindings(parsed.organizationId, parsed.teamId);
        const memberBindings = bindings.filter((binding) => binding.userId === parsed.userId);
        if (memberBindings.length === 0) {
          throw new TeamMembershipNotFoundError(parsed.userId);
        }

        // Refuses a removal that TAKES the last admin away. A team a seat
        // correction already left with none stays editable, so it can be repaired.
        const administratorsBefore = await this.effectiveAdminUserIds({
          organizationId: parsed.organizationId,
          bindings,
        });
        const administratorsAfter = await this.effectiveAdminUserIds({
          organizationId: parsed.organizationId,
          bindings: bindings.filter((binding) => binding.userId !== parsed.userId),
        });
        if (administratorsBefore.size > 0 && administratorsAfter.size === 0) {
          if (parsed.actor.type === "user" && parsed.actor.id === parsed.userId) {
            throw new CannotRemoveSelfAsLastAdminError(team.name);
          }

          throw new TeamLastAdminRequiredError(team.name);
        }

        await this.deps.grants.revokeBindings({
          organizationId: parsed.organizationId,
          bindingIds: memberBindings.map(({ id }) => id),
          actor: parsed.actor,
          reason: "removed from team",
        });
      },
    });
  }

  async getTeamWithMembers(
    input: GetOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeamWithMembers> {
    const parsed = getOrganizationTeamWithMembersInputSchema.parse(input);
    const team = await this.deps.teams.getBySlug(parsed);
    if (!parsed.callerCanManage && team.isPersonal && team.ownerUserId !== parsed.callerUserId) {
      throw new TeamNotFoundError(team.id);
    }

    const bindings = await this.deps.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: [team.id],
    });

    return {
      ...team,
      members: shapeTeamMembers({
        teamId: team.id,
        bindings: bindings.get(team.id) ?? [],
        visibleEmailUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
      }),
    };
  }

  async listTeamsWithMembers(
    input: ListOrganizationTeamsWithMembersInput,
  ): Promise<OrganizationTeamWithMembers[]> {
    const parsed = listOrganizationTeamsWithMembersInputSchema.parse(input);
    const teams = await this.deps.teams.findActive({
      organizationId: parsed.organizationId,
      visibleToUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
    });
    const bindings = await this.deps.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: teams.map(({ id }) => id),
    });

    return teams.map((team) => ({
      ...team,
      members: shapeTeamMembers({
        teamId: team.id,
        bindings: bindings.get(team.id) ?? [],
        visibleEmailUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
      }),
    }));
  }

  async createTeamWithMembers(
    input: CreateOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeam> {
    const parsed = createOrganizationTeamWithMembersInputSchema.parse(input);
    await this.validateTeamMembers(parsed.organizationId, parsed.members);
    if (!parsed.members.some((member) => memberTarget(member).role === "ADMIN")) {
      throw new TeamLastAdminRequiredError(parsed.name);
    }

    // Creating a team makes its creator its ADMIN (a consequence of creating it); everyone
    // else is bounded by the creator, read at the organization since the team does not exist yet.
    const isCreatorAsAdmin = (member: OrganizationTeamMemberInput) =>
      parsed.caller.type === "user" &&
      member.userId === parsed.caller.id &&
      memberTarget(member).role === "ADMIN";
    const others = parsed.members.filter((member) => !isCreatorAsAdmin(member));
    await OrganizationGrantCeilingService.create(this.deps.grants).assertWithinCaller({
      organizationId: parsed.organizationId,
      caller: parsed.caller,
      grants: others.map((member): OrganizationIntendedGrant => ({
        ...memberTarget(member),
        scopeType: "ORGANIZATION",
        scopeId: parsed.organizationId,
        confersAs: "TEAM",
      })),
    });

    const team = await this.deps.createTeam({
      organizationId: parsed.organizationId,
      name: parsed.name,
    });
    const creator = parsed.members.filter(isCreatorAsAdmin);
    if (creator.length > 0) {
      await this.attachTeamMembers({
        organizationId: parsed.organizationId,
        teamId: team.id,
        members: creator,
        caller: { type: "system" },
        actor: parsed.actor,
      });
    }
    if (others.length > 0) {
      await this.attachTeamMembers({
        organizationId: parsed.organizationId,
        teamId: team.id,
        members: others,
        caller: parsed.caller,
        actor: parsed.actor,
      });
    }

    return team;
  }

  async updateTeamWithMembers(input: UpdateOrganizationTeamWithMembersInput): Promise<void> {
    const parsed = updateOrganizationTeamWithMembersInputSchema.parse(input);
    const team = await this.deps.teams.getById(parsed.teamId);
    if (team.isPersonal) {
      const keepsOwner =
        parsed.members.length === 0 ||
        (parsed.members.length === 1 &&
          parsed.members[0]!.userId === team.ownerUserId &&
          memberTarget(parsed.members[0]!).role === "ADMIN");
      if (!keepsOwner) {
        throw new PersonalWorkspaceNotManagedHereError(team.name);
      }
    }

    await this.validateTeamMembers(team.organizationId, parsed.members);
    if (parsed.members.length === 0) {
      await this.deps.teams.update({
        organizationId: team.organizationId,
        teamId: team.id,
        name: parsed.name,
      });

      return;
    }

    await this.deps.teams.fenceMembershipChange({
      teamId: team.id,
      organizationId: team.organizationId,
      expectedUpdatedAt: fromDate(team.updatedAt),
      name: parsed.name,
      change: async () => {
        const bindings = await this.teamBindings(team.organizationId, team.id);
        const directBindings = bindings.filter(({ userId }) => userId !== null);
        const plan = planTeamMembership(directBindings, parsed.members);
        const administratorsAfter = await this.effectiveAdminUserIds({
          organizationId: team.organizationId,
          bindings,
          directAdminUserIds: directAdminIdsAfterPlan(directBindings, plan),
        });
        const administratorsBefore = await this.effectiveAdminUserIds({
          organizationId: team.organizationId,
          bindings,
        });
        if (administratorsBefore.size > 0 && administratorsAfter.size === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }
        // Every add and role change is asked before the first write, so a refusal leaves none.
        await OrganizationGrantCeilingService.create(this.deps.grants).assertWithinCaller({
          organizationId: team.organizationId,
          caller: parsed.caller,
          grants: [...plan.membersToAdd.map(memberTarget), ...plan.bindingsToChange].map(
            ({ role, customRoleId }): OrganizationIntendedGrant => ({
              role,
              customRoleId,
              scopeType: "TEAM",
              scopeId: team.id,
            }),
          ),
        });

        await this.emitTeamMembershipPlan({
          organizationId: team.organizationId,
          teamId: team.id,
          caller: parsed.caller,
          actor: parsed.actor,
          plan,
        });
      },
    });
  }

  private teamBindings(organizationId: string, teamId: string): Promise<AuthzAccessBinding[]> {
    return this.deps.authz.listScopeBindings({
      organizationId,
      scopeType: "TEAM",
      scopeIds: [teamId],
    });
  }

  private async effectiveAdminUserIds(input: {
    organizationId: string;
    bindings: AuthzAccessBinding[];
    directAdminUserIds?: Iterable<string>;
  }): Promise<Set<string>> {
    const administrators = new Set(
      input.directAdminUserIds ??
        input.bindings.flatMap((binding) =>
          binding.role === "ADMIN" && binding.userId ? [binding.userId] : [],
        ),
    );
    const adminGroupIds = input.bindings.flatMap((binding) =>
      binding.role === "ADMIN" && binding.groupId ? [binding.groupId] : [],
    );
    const members = await this.deps.groups.findMembersForGroups({
      organizationId: input.organizationId,
      groupIds: [...new Set(adminGroupIds)],
    });
    for (const groupMembers of members.values()) {
      for (const member of groupMembers) {
        administrators.add(member.userId);
      }
    }

    return administrators;
  }

  private async validateTeamMembers(
    organizationId: string,
    members: OrganizationTeamMemberInput[],
  ): Promise<void> {
    await this.deps.teams.getOrganizationMembers({
      organizationId,
      userIds: [...new Set(members.map(({ userId }) => userId))],
    });
    const customMembers = members.filter(({ role }) => role.startsWith("custom:"));
    if (customMembers.length === 0) {
      return;
    }

    const roles = await this.deps.authz.listUserCreatedRoles({ organizationId });
    const assignable = new Set(roles.map(({ id }) => id));
    for (const member of customMembers) {
      if (!member.customRoleId) {
        throw new TeamCustomRoleRequiredError();
      }

      if (!assignable.has(member.customRoleId)) {
        throw new TeamCustomRoleNotAssignableError(member.customRoleId);
      }
    }
  }

  private attachTeamMembers(input: {
    organizationId: string;
    teamId: string;
    members: OrganizationTeamMemberInput[];
    caller: AuthzGrantCaller;
    actor: OrganizationLedgerActor;
  }): Promise<unknown> {
    return this.deps.grants.attachBindings({
      organizationId: input.organizationId,
      bindings: input.members.map((member) => ({
        bindingId: this.deps.teamIdentities.createBindingId(),
        principal: { userId: member.userId },
        ...memberTarget(member),
        scopeType: "TEAM" as const,
        scopeId: input.teamId,
      })),
      caller: input.caller,
      actor: input.actor,
      onDuplicate: "skip",
    });
  }

  private async emitTeamMembershipPlan(input: {
    organizationId: string;
    teamId: string;
    caller: AuthzGrantCaller;
    actor: OrganizationLedgerActor;
    plan: TeamMembershipPlan;
  }): Promise<void> {
    if (input.plan.membersToAdd.length > 0) {
      await this.attachTeamMembers({
        organizationId: input.organizationId,
        teamId: input.teamId,
        members: input.plan.membersToAdd,
        caller: input.caller,
        actor: input.actor,
      });
    }

    for (const binding of input.plan.bindingsToChange) {
      await this.deps.grants.changeBindingRole({
        organizationId: input.organizationId,
        bindingId: binding.bindingId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        caller: input.caller,
        actor: input.actor,
      });
    }

    if (input.plan.bindingIdsToRemove.length > 0) {
      await this.deps.grants.revokeBindings({
        organizationId: input.organizationId,
        bindingIds: input.plan.bindingIdsToRemove,
        actor: input.actor,
        reason: "removed from team",
      });
    }
  }
}
