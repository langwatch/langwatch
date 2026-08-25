import type { LedgerActor } from "@langwatch/actor";
import {
  RoleInUseError,
  RoleNotAssignableError,
  RoleNotFoundError,
  RoleOrganizationMismatchError,
  RoleReservedNameError,
  TeamNotFoundError,
  UserNotTeamMemberError,
  type Role,
  type RoleBindingScopeType,
  type RoleCreate,
  type RoleUpdate,
  RoleService as RoleServiceContract,
} from "@langwatch/role-contract";
import { RolePermissionPort, RoleScopePort } from "../ports/role.port";
import { RoleRepository } from "../repositories/role.repository";

export interface RoleServiceDependencies {
  repository: RoleRepository;
  scope: RoleScopePort;
  permission: RolePermissionPort;
}

export class RoleService extends RoleServiceContract {
  private constructor(private readonly deps: RoleServiceDependencies) {
    super();
  }

  static create(deps: RoleServiceDependencies): RoleService {
    return new RoleService(deps);
  }

  list(input: { organizationId: string }): Promise<Role[]> {
    return this.deps.repository.findAll(input.organizationId);
  }

  async get(input: { roleId: string }): Promise<Role> {
    const role = await this.deps.repository.tryFindById(input.roleId);
    if (!role || role.kind !== "custom") throw new RoleNotFoundError(input.roleId);
    return role;
  }

  async getForOrganization(input: { roleId: string; organizationId: string }): Promise<Role> {
    const role = await this.deps.repository.tryFindCustomByIdInOrganization(input);
    if (!role) throw new RoleNotFoundError(input.roleId);
    return role;
  }

  async tryGet(input: { roleId: string }): Promise<Role | null> {
    const role = await this.deps.repository.tryFindById(input.roleId);
    return role?.kind === "custom" ? role : null;
  }

  private assertName(name: string | undefined): void {
    if (name?.startsWith("apikey:")) throw new RoleReservedNameError();
  }

  async create(input: { role: RoleCreate; actor: LedgerActor }): Promise<Role> {
    this.assertName(input.role.name);
    return this.deps.repository.create(input);
  }

  async update(input: { roleId: string; changes: RoleUpdate; actor: LedgerActor }): Promise<Role> {
    this.assertName(input.changes.name);
    const existing = await this.get({ roleId: input.roleId });
    return this.deps.repository.update({ roleId: existing.id, changes: input.changes, actor: input.actor });
  }

  async updateForOrganization(input: { roleId: string; organizationId: string; changes: RoleUpdate; actor: LedgerActor }): Promise<Role> {
    this.assertName(input.changes.name);
    await this.getForOrganization({ roleId: input.roleId, organizationId: input.organizationId });
    const updated = await this.deps.repository.update({ roleId: input.roleId, changes: input.changes, actor: input.actor });
    if (updated.organizationId !== input.organizationId) throw new RoleNotFoundError(input.roleId);
    return updated;
  }

  private async delete(input: { roleId: string; organizationId: string; actor: LedgerActor }): Promise<{ success: true }> {
    const role = await this.deps.repository.tryFindCustomByIdInOrganization({ roleId: input.roleId, organizationId: input.organizationId });
    if (!role) throw new RoleNotFoundError(input.roleId);
    const holders = await Promise.all([
      this.deps.repository.countAssignedUsers(input.roleId),
      this.deps.repository.countRoleBindings({ roleId: input.roleId, organizationId: input.organizationId }),
    ]);
    if (holders[0] > 0 || holders[1] > 0) throw new RoleInUseError({ userCount: holders[0], bindingCount: holders[1] });
    const deleted = await this.deps.repository.deleteIfUnused(input);
    if (!deleted) {
      const [userCount, bindingCount] = await Promise.all([
        this.deps.repository.countAssignedUsers(input.roleId),
        this.deps.repository.countRoleBindings({ roleId: input.roleId, organizationId: input.organizationId }),
      ]);
      const stillPresent = await this.deps.repository.tryFindCustomByIdInOrganization({ roleId: input.roleId, organizationId: input.organizationId });
      if (!stillPresent) throw new RoleNotFoundError(input.roleId);
      throw new RoleInUseError({ userCount, bindingCount });
    }
    return { success: true };
  }

  async remove(input: { roleId: string; actor: LedgerActor }): Promise<{ success: true }> {
    const role = await this.get({ roleId: input.roleId });
    return this.delete({ roleId: role.id, organizationId: role.organizationId, actor: input.actor });
  }

  removeForOrganization(input: { roleId: string; organizationId: string; actor: LedgerActor }): Promise<{ success: true }> {
    return this.delete(input);
  }

  async assignToUser(input: { userId: string; teamId: string; customRoleId: string; actor: LedgerActor }): Promise<{ success: true }> {
    const [role, team] = await Promise.all([
      this.deps.repository.tryFindById(input.customRoleId),
      this.deps.repository.tryFindTeam(input.teamId),
    ]);
    if (!role || role.kind !== "custom") throw new RoleNotFoundError(input.customRoleId);
    if (!team) throw new TeamNotFoundError();
    if (role.organizationId !== team.organizationId) throw new RoleOrganizationMismatchError();
    const exclusivePermission = role.permissions.find((permission) =>
      this.deps.permission.isOrganizationExclusive(permission),
    );
    if (exclusivePermission) {
      throw this.deps.permission.organizationExclusiveScopeError({
        permission: exclusivePermission,
        scopeType: "TEAM",
      });
    }
    const member = await this.deps.repository.hasTeamMember({ userId: input.userId, organizationId: team.organizationId, teamId: input.teamId });
    if (!member) throw new UserNotTeamMemberError();
    await this.deps.scope.assertNoPersonalTeamScope({ scopes: [{ scopeType: "TEAM", scopeId: input.teamId }] });
    await this.deps.repository.assign(input);
    return { success: true };
  }

  async removeFromUser(input: { userId: string; teamId: string; actor: LedgerActor }): Promise<{ success: true }> {
    await this.deps.scope.assertNoPersonalTeamScope({ scopes: [{ scopeType: "TEAM", scopeId: input.teamId }] });
    await this.deps.repository.remove(input);
    return { success: true };
  }

  tryGetUserBinding(input: { userId: string; organizationId: string; teamId: string }): Promise<{ customRoleId: string } | null> {
    return this.deps.repository.tryFindUserBinding(input);
  }

  async validateAssignable(input: { roleIds: string[]; organizationId: string }): Promise<void> {
    if (input.roleIds.length === 0) return;
    const valid = await this.deps.repository.findAssignable(input.roleIds, input.organizationId);
    if (input.roleIds.some((id) => !valid.some((role) => role.id === id))) throw new RoleNotAssignableError();
  }

  filterAssignable(input: { roleIds: string[]; organizationId: string }): Promise<string[]> {
    if (input.roleIds.length === 0) return Promise.resolve([]);
    return this.deps.repository.findAssignable(input.roleIds, input.organizationId).then((roles) => roles.map((role) => role.id));
  }

  async assertNoOrganizationExclusivePermissionsBelowOrganizationScope(input: { organizationId: string; customBindings: Array<{ customRoleId: string; scopeType: RoleBindingScopeType }> }): Promise<void> {
    const bindings = input.customBindings.filter((binding) => binding.scopeType !== "ORGANIZATION");
    if (bindings.length === 0) return;
    const roles = await this.deps.repository.findAssignablePermissions([...new Set(bindings.map((binding) => binding.customRoleId))], input.organizationId);
    const permissions = new Map(roles.map((role) => [role.id, Array.isArray(role.permissions) ? role.permissions.filter((permission): permission is string => typeof permission === "string") : []]));
    for (const binding of bindings) {
      const permission = (permissions.get(binding.customRoleId) ?? []).find((candidate) => this.deps.permission.isOrganizationExclusive(candidate));
      if (permission) {
        throw this.deps.permission.organizationExclusiveScopeError({
          permission,
          scopeType: binding.scopeType,
        });
      }
    }
  }

  isExclusiveToApiKey(input: { roleId: string; apiKeyId: string }): Promise<boolean> {
    return this.deps.repository.isExclusiveToApiKey(input);
  }

  removeExclusiveApiKeyRoles(input: { roleIds: string[]; apiKeyId: string; organizationId: string; actor: LedgerActor; awaitProjection?: boolean }): Promise<void> {
    return this.deps.repository.removeExclusiveApiKeyRoles(input);
  }
}
