/**
 * A group's bindings: what the group may reach, validated against the roles this organization
 * can assign and the scopes it owns.
 */
import {
  AuthzLedgerUnavailableError,
  DuplicateBindingError,
  type AuthzGrantsService,
  type AuthzService,
  type AuthzAccessBinding,
  type AuthzTeamMemberBinding,
  bindingScopeCanGrantPermission,
} from "@langwatch/authz-contract";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  OrganizationService as OrganizationServiceContract,
  OrganizationNotFoundError,
  GroupBindingAlreadyExistsError,
  GroupBindingNotFoundError,
  GroupCustomRoleRequiredError,
  GroupRoleNotAssignableError,
  GroupRoleScopeError,
  GroupScopeNotInOrganizationError,
  ScimManagedGroupError,
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  PersonalTeamProtectedError,
  PersonalProjectOwnerMismatchError,
  PersonalWorkspaceNotManagedHereError,
  TeamMemberAlreadyAddedError,
  TeamNotFoundError,
  TeamMembershipNotFoundError,
  UserNotInOrganizationError,
  TeamLastAdminRequiredError,
  TeamCustomRoleNotAssignableError,
  TeamCustomRoleRequiredError,
  CannotRemoveSelfAsLastAdminError,
  TeamSlugConflictError,
  addOrganizationGroupBindingInputSchema,
  addOrganizationTeamMemberInputSchema,
  applyOrganizationGroupEditsInputSchema,
  changeOrganizationGroupMemberInputSchema,
  claimOrganizationBillingCustomerInputSchema,
  createOrganizationGroupInputSchema,
  createOrganizationTeamInputSchema,
  createOrganizationTeamWithMembersInputSchema,
  deleteOrganizationGroupInputSchema,
  findPersonalWorkspaceInputSchema,
  getOrganizationGroupInputSchema,
  getOrganizationTeamInputSchema,
  getOrganizationTeamByIdInputSchema,
  getOrganizationTeamBySlugForMemberInputSchema,
  getOrganizationTeamWithMembersInputSchema,
  getOldestTeamInputSchema,
  getOrganizationBillingProfileInputSchema,
  getOrganizationIdByTeamIdInputSchema,
  getOrganizationMembersInputSchema,
  getOrganizationSettingsInputSchema,
  listMemberOrganizationGroupsInputSchema,
  listOrganizationGroupsInputSchema,
  listOrganizationTeamsInputSchema,
  listOrganizationTeamsWithMembersInputSchema,
  listOrganizationTeamAccessInputSchema,
  personalWorkspaceFeaturesInputSchema,
  personalWorkspaceInputSchema,
  readPersonalFeatures,
  changeOrganizationTeamMemberInputSchema,
  removeOrganizationGroupBindingInputSchema,
  renameOrganizationGroupInputSchema,
  updateOrganizationTeamInputSchema,
  updateOrganizationTeamWithMembersInputSchema,
  updateOrganizationSettingsInputSchema,
  type AddOrganizationGroupBindingInput,
  type AddOrganizationTeamMemberInput,
  type ApplyOrganizationGroupEditsInput,
  type ChangeOrganizationGroupMemberInput,
  type ClaimOrganizationBillingCustomerInput,
  type CreateOrganizationGroupInput,
  type CreateOrganizationTeamInput,
  type CreateOrganizationTeamWithMembersInput,
  type DeleteOrganizationGroupInput,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type GetOrganizationGroupInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type GetOrganizationTeamWithMembersInput,
  type GetOldestTeamInput,
  type GetOrganizationBillingProfileInput,
  type GetOrganizationIdByTeamIdInput,
  type GetOrganizationMembersInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type ListOrganizationTeamsInput,
  type ListOrganizationTeamsWithMembersInput,
  type ListOrganizationTeamAccessInput,
  type OrganizationBillingProfile,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type OrganizationGroupBindingInput,
  type OrganizationGroupDetails,
  type OrganizationGroupMember,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type OrganizationTeam,
  type OrganizationLedgerActor,
  type OrganizationTeamAccess,
  type OrganizationTeamAccessMember,
  type OrganizationTeamAccessProject,
  type OrganizationTeamMember,
  type OrganizationTeamMemberInput,
  type OrganizationTeamPage,
  type OrganizationTeamWithMembers,
  type OrganizationSettings,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceFeaturesInput,
  type PersonalWorkspaceInput,
  type RemoveOrganizationGroupBindingInput,
  type RenameOrganizationGroupInput,
  type RemoveOrganizationTeamMemberInput,
  type UpdateOrganizationTeamInput,
  type UpdateOrganizationTeamWithMembersInput,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
} from "@langwatch/organization-contract";
import type {
  GroupIdentityPort,
  OrganizationRepository,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceFeatureProject,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../ports/organization.port";
import type { GroupRepository } from "../repositories/group.repository";
import type { TeamRepository } from "../repositories/team.repository";

import type { OrganizationGroupDependencies } from "./organization-group.service";

type GroupBindingWrite = {
  bindingId: string;
  principal: { groupId: string };
  role: OrganizationGroupBindingInput["role"];
  customRoleId: string | null;
  scopeType: OrganizationGroupBindingInput["scopeType"];
  scopeId: OrganizationGroupBindingInput["scopeId"];
};

export class OrganizationGroupBindingService {
  static create(dependencies: OrganizationGroupDependencies): OrganizationGroupBindingService {
    return new OrganizationGroupBindingService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationGroupDependencies) {}

  private get groupIdentities(): OrganizationGroupDependencies["groupIdentities"] {
    return this.dependencies.groupIdentities;
  }

  private get groups(): OrganizationGroupDependencies["groups"] {
    return this.dependencies.groups;
  }

  private get teams(): OrganizationGroupDependencies["teams"] {
    return this.dependencies.teams;
  }

  private get authz(): OrganizationGroupDependencies["authz"] {
    return this.dependencies.authz;
  }

  private get grants(): OrganizationGroupDependencies["grants"] {
    return this.dependencies.grants;
  }

  async validateGroupBindings(
    organizationId: string,
    bindings: OrganizationGroupBindingInput[],
  ): Promise<void> {
    const customBindings = bindings.filter(({ role }) => role === "CUSTOM");
    if (customBindings.some(({ customRoleId }) => !customRoleId)) {
      throw new GroupCustomRoleRequiredError();
    }

    const customRoleIds = [
      ...new Set(customBindings.map(({ customRoleId }) => customRoleId as string)),
    ];
    const roles =
      customRoleIds.length === 0 ? [] : await this.authz.listUserCreatedRoles({ organizationId });
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const missingRole = customRoleIds.find((id) => !rolesById.has(id));
    if (missingRole) {
      throw new GroupRoleNotAssignableError(missingRole);
    }

    for (const binding of customBindings) {
      const role = rolesById.get(binding.customRoleId as string);
      const permissions = Array.isArray(role?.permissions)
        ? role.permissions.filter(
            (permission): permission is string => typeof permission === "string",
          )
        : [];
      const refused = permissions.find(
        (permission) =>
          !bindingScopeCanGrantPermission({
            scopeType: binding.scopeType,
            permission,
          }),
      );
      if (refused) {
        throw new GroupRoleScopeError(refused, binding.scopeType);
      }
    }

    await this.assertGroupScopes(organizationId, bindings);
  }

  async assertGroupScopes(
    organizationId: string,
    bindings: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>,
  ): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.authz.tryResolveScope(
        binding.scopeType === "ORGANIZATION"
          ? { organizationId: binding.scopeId }
          : binding.scopeType === "TEAM"
            ? { teamId: binding.scopeId }
            : { projectId: binding.scopeId },
      );
      const resolvedOrganizationId =
        scope?.type === "organization" ? scope.id : scope?.organizationId;
      if (!scope || resolvedOrganizationId !== organizationId) {
        throw new GroupScopeNotInOrganizationError(binding.scopeType);
      }

      if (scope.type === "team" || scope.type === "project") {
        const team = await this.teams.get({
          organizationId,
          teamId: scope.type === "team" ? scope.id : scope.teamId,
        });
        if (team.isPersonal) {
          throw new PersonalWorkspaceNotManagedHereError();
        }
      }
    }
  }

  groupBindingWrite(groupId: string, binding: OrganizationGroupBindingInput): GroupBindingWrite {
    return {
      bindingId: this.groupIdentities.createBindingId(),
      principal: { groupId },
      role: binding.role,
      customRoleId: binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    };
  }

  async readGroupBindings(input: {
    organizationId: string;
    groupId: string;
  }): Promise<OrganizationGroupBinding[]> {
    const bindings = await this.authz.listGroupBindings({
      organizationId: input.organizationId,
      groupId: input.groupId,
    });

    return bindings.map((binding) => this.toGroupBinding(binding));
  }

  toGroupBinding(binding: {
    id: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
    customRole: { name: string } | null;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }): OrganizationGroupBinding {
    return {
      id: binding.id,
      role: binding.role,
      customRoleId: binding.customRoleId,
      customRoleName: binding.customRole?.name ?? null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    };
  }

  groupBindingsByGroup(
    bindings: Array<{
      id: string;
      groupId: string | null;
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId: string | null;
      customRole: { name: string } | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>,
  ): Map<string, OrganizationGroupBinding[]> {
    const result = new Map<string, OrganizationGroupBinding[]>();
    for (const binding of bindings) {
      if (!binding.groupId) {
        continue;
      }

      const groupBindings = result.get(binding.groupId) ?? [];
      groupBindings.push(this.toGroupBinding(binding));
      result.set(binding.groupId, groupBindings);
    }

    return result;
  }
}
