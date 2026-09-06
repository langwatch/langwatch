/**
 * The team side of an invitation: turning whichever form the request used into validated team
 * assignments, and refusing a custom role this organization may not assign.
 */
import { CustomRoleIdRequiredError } from "@langwatch/authz-contract";
import {
  CustomRoleNotAssignableError,
  OrganizationUserRole,
  TeamNotInOrganizationError,
  TeamUserRole,
} from "@langwatch/organization-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository.ts";
import { isCustomRole } from "../rules/custom-role-naming.rules.ts";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "../rules/member-role-constraints.rules.ts";
import {
  type CreateInvitesInviteInput,
  type InviteServiceDependencies,
  type ResolvedInviteTeams,
  type TeamAssignmentInput,
} from "../rules/invite-contracts.rules.ts";

export class InviteTeamAssignmentService {
  static create(deps: InviteServiceDependencies): InviteTeamAssignmentService {
    return new InviteTeamAssignmentService(deps);
  }

  private constructor(private readonly deps: InviteServiceDependencies) {}

  private get invites(): OrganizationInviteRepository {
    return this.deps.invites;
  }

  private get roleService(): RoleService {
    return this.deps.roles;
  }

  /**
   * Validates that team IDs belong to the organization.
   * Returns the list of valid team IDs.
   */
  async validateTeamIds({
    teamIds,
    organizationId,
  }: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]> {
    return await this.invites.findTeamIdsInOrganization({ teamIds, organizationId });
  }

  /**
   * The teams an invite should join, or null when the invite names none and the organization
   * has no default team to fall back on.
   */
  async tryResolveInviteTeams({
    organizationId,
    invite,
    isStrict,
  }: {
    organizationId: string;
    invite: CreateInvitesInviteInput;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    if (invite.teams && invite.teams.length > 0) {
      return this.resolveExplicitInviteTeams({
        organizationId,
        teams: invite.teams,
        isStrict,
      });
    }

    if (invite.teamIds?.trim()) {
      return this.resolveLegacyInviteTeams({
        organizationId,
        teamIds: invite.teamIds,
        role: invite.role,
        isStrict,
      });
    }

    return null;
  }

  /**
   * Resolves explicit team role entries: the teams must belong to the organization,
   * custom-role forms are normalized, and the custom roles must be assignable. Returns null
   * when lenient validation drops the invite (no valid teams, or an invalid custom role).
   */
  private async resolveExplicitInviteTeams({
    organizationId,
    teams,
    isStrict,
  }: {
    organizationId: string;
    teams: NonNullable<CreateInvitesInviteInput["teams"]>;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    const teamIds = teams.map((team) => team.teamId);
    const validTeamIds = await this.validateTeamIds({
      teamIds,
      organizationId,
    });

    if (isStrict) {
      this.assertAllTeamIdsValid({ requestedTeamIds: teamIds, validTeamIds });
    }

    if (validTeamIds.length === 0) {
      return null;
    }

    const teamAssignments = this.normalizeTeamAssignments({
      teams,
      validTeamIds,
      isStrict,
    });

    const customRolesValid = await this.validateInviteCustomRoles({
      organizationId,
      teamAssignments,
      isStrict,
    });
    if (!customRolesValid) {
      return null;
    }

    return { teamAssignments, teamIdsString: validTeamIds.join(",") };
  }

  /**
   * Resolves the legacy comma-separated team id form: each valid team gets
   * the default team role for the invite's organization role. Returns null
   * when lenient validation leaves no valid teams.
   */
  private async resolveLegacyInviteTeams({
    organizationId,
    teamIds,
    role,
    isStrict,
  }: {
    organizationId: string;
    teamIds: string;
    role: OrganizationUserRole;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    const teamIdArray = teamIds
      .split(",")
      .map((teamId) => teamId.trim())
      .filter(Boolean);

    const validTeamIds = await this.validateTeamIds({
      teamIds: teamIdArray,
      organizationId,
    });

    if (isStrict) {
      this.assertAllTeamIdsValid({
        requestedTeamIds: teamIdArray,
        validTeamIds,
      });
    }

    if (validTeamIds.length === 0) {
      return null;
    }

    return {
      teamAssignments: validTeamIds.map((teamId) => ({
        teamId,
        role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
      })),
      teamIdsString: validTeamIds.join(","),
    };
  }

  /** Refuses the first requested team id that is not in the organization. */
  private assertAllTeamIdsValid({
    requestedTeamIds,
    validTeamIds,
  }: {
    requestedTeamIds: string[];
    validTeamIds: string[];
  }): void {
    const invalidTeamId = requestedTeamIds.find((teamId) => !validTeamIds.includes(teamId));
    if (invalidTeamId) {
      throw new TeamNotInOrganizationError(invalidTeamId);
    }
  }

  /**
   * Narrows explicit team role entries to valid teams only, folding the `custom:{roleId}`
   * string form and `CUSTOM` into TeamUserRole.CUSTOM. An assignment naming a custom role
   * without its id is refused in strict mode and dropped in lenient mode.
   */
  private normalizeTeamAssignments({
    teams,
    validTeamIds,
    isStrict,
  }: {
    teams: NonNullable<CreateInvitesInviteInput["teams"]>;
    validTeamIds: string[];
    isStrict: boolean;
  }): TeamAssignmentInput[] {
    return teams
      .filter((team) => validTeamIds.includes(team.teamId))
      .map((team) => {
        const isCustomString = typeof team.role === "string" && isCustomRole(team.role);
        const isCustom = isCustomString || team.role === TeamUserRole.CUSTOM;

        return {
          teamId: team.teamId,
          role: isCustom ? TeamUserRole.CUSTOM : (team.role as TeamUserRole),
          customRoleId: isCustom && team.customRoleId ? team.customRoleId : undefined,
        };
      })
      .filter((team) => {
        if (team.role === TeamUserRole.CUSTOM && !team.customRoleId) {
          if (isStrict) {
            throw new CustomRoleIdRequiredError();
          }

          return false;
        }

        return true;
      });
  }

  /**
   * True when every custom role named by these assignments is assignable in
   * this organization. In strict mode an invalid custom role is refused
   * instead; in lenient mode the caller drops the whole invite.
   */
  private async validateInviteCustomRoles({
    organizationId,
    teamAssignments,
    isStrict,
  }: {
    organizationId: string;
    teamAssignments: TeamAssignmentInput[];
    isStrict: boolean;
  }): Promise<boolean> {
    const customRoleIds = teamAssignments
      .filter((team) => team.customRoleId)
      .map((team) => team.customRoleId!);
    if (customRoleIds.length === 0) {
      return true;
    }

    // Through the role service, which is where assignability is defined: an invite validated
    // against a different rule than `applyInvite` applies would be accepted here and silently
    // dropped on acceptance. The service rather than `RoleApp`: this asks which custom roles
    // an organization may assign, not whether the caller may administer them, and there is no
    // administrator on this path.
    const roleService = this.roleService;
    const validCustomRoleIds = new Set(
      await roleService.filterAssignable({
        roleIds: customRoleIds,
        organizationId,
      }),
    );
    const invalidRoleId = customRoleIds.find((id) => !validCustomRoleIds.has(id));
    if (invalidRoleId) {
      if (isStrict) {
        throw new CustomRoleNotAssignableError(invalidRoleId);
      }

      return false;
    }

    return true;
  }

  /**
   * Outstanding invitations with their state visible (D11) and the
   * acceptance link each one carries — needed when no email provider is
   * configured to hand the invite to the person another way.
   */
}
