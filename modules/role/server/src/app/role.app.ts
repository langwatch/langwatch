/**
 * The role feature's application: two tRPC namespaces and one REST family reach
 * this one object. Three operations name a ROLE rather than the organization
 * their check runs against, so those checks run here, where the row is.
 */
import { ledgerActorFor, type LedgerActor } from "@langwatch/actor";
import {
  AuthzApi,
  bindingScopeCanGrantPermission,
  PermissionDeniedError,
  type AuthzAccessBreakdownOutput,
  type AuthzApplyMemberBindingsInput,
  type AuthzBindingMutationSuccess,
  type AuthzCreateBindingInput,
  type AuthzCreateBindingOutput,
  type AuthzDeleteBindingInput,
  type AuthzListManagedBindingsForOrganizationOutput,
  type AuthzListManagedBindingsForUserOutput,
  type AuthzUpdateBindingInput,
} from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import {
  OrgExclusivePermissionScopeError,
  RoleApi,
  RoleInUseError,
  RoleNotAssignableError,
  RoleTeamNotFoundError,
  RoleUserNotTeamMemberError,
  ROLE_KIND,
  ROLE_KSUID_RESOURCE,
  roleSchema,
  ROLE_PERMISSION_ACTIONS,
  ROLE_PERMISSION_RESOURCES,
  roleResourceIsOrganizationExclusive,
  type Role,
  type RoleBindingScopeType,
  type RoleCaller,
  type RoleCreate,
  type RolePermissionCatalog,
  type RoleUpdate,
  type RoleUserCaller,
  type RoleWriteAcknowledged,
} from "@langwatch/role-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { RoleRepositories } from "../repositories/role.repositories.ts";
import { RoleService } from "../services/role.service.ts";

/** What the composing process owns and this feature may not build for itself. */
export interface RoleInfrastructure {
  /** The personal-workspace fence a team binding is refused at. */
  readonly scope: {
    assertNoPersonalTeamScope(input: {
      scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
    }): Promise<void>;
  };
  /** Whether the organization's plan carries custom roles. */
  readonly plan: {
    assertCustomRolesAllowed(input: { organizationId: string }): Promise<void>;
  };
  /** The identifier format a new binding is written under. */
  readonly bindingIds: {
    newBindingId(): string;
  };
}

type RoleSetup = FeatureSetup<
  typeof RoleApp.dependencies,
  RoleInfrastructure,
  undefined,
  RoleRepositories
>;

const WRITE_ACKNOWLEDGED: RoleWriteAcknowledged = { success: true };

export class RoleApp implements RoleApi {
  static readonly contract = RoleApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    organizations: OrganizationApi,
    users: UserApi,
  };

  #roles: RoleService;
  #permissions: AuthzApi;
  #organizations: OrganizationApi;
  #users: UserApi;
  #scope: RoleInfrastructure["scope"];
  #plan: RoleInfrastructure["plan"];
  #bindingIds: RoleInfrastructure["bindingIds"];

  private constructor(
    repositories: RoleRepositories,
    dependencies: RoleSetup["dependencies"],
    infrastructure: RoleInfrastructure,
  ) {
    this.#roles = RoleService.create({ repository: repositories.roles });
    this.#permissions = dependencies.permissions;
    this.#organizations = dependencies.organizations;
    this.#users = dependencies.users;
    this.#scope = infrastructure.scope;
    this.#plan = infrastructure.plan;
    this.#bindingIds = infrastructure.bindingIds;
  }

  static create({ repositories, dependencies, infrastructure }: RoleSetup): RoleApp {
    return new RoleApp(repositories, dependencies, infrastructure);
  }

  // ── custom roles ───────────────────────────────────────────────────────────

  /** Every custom role defined in the organization, as the ledger projects them. */
  async listRoles(input: { organizationId: string }): Promise<Role[]> {
    const roles = await this.#permissions.listUserCreatedRoles(input);

    return roles.map((role) =>
      roleSchema.parse({
        id: role.id,
        organizationId: role.organizationId,
        name: role.name,
        description: role.description,
        permissions: permissionsOf(role.permissions),
        kind: ROLE_KIND.CUSTOM,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }),
    );
  }

  /** One custom role, for a caller who may view the organization that owns it. */
  async getRole(input: { roleId: string }, by: RoleUserCaller): Promise<Role> {
    const role = await this.#roles.getById(input);
    await this.#assertMayReach(by, role.organizationId, "organization:view");

    return role;
  }

  /** One custom role inside an organization the credential already resolved. */
  getRoleInOrganization(input: { roleId: string; organizationId: string }): Promise<Role> {
    return this.#roles.getInOrganization(input);
  }

  /** Defines a custom role, attributed to the caller who asked for it. */
  async createRole(input: { role: RoleCreate }, by: RoleCaller): Promise<Role> {
    this.#roles.assertNameAllowed(input.role.name);
    await this.#plan.assertCustomRolesAllowed({ organizationId: input.role.organizationId });
    await this.#roles.assertNameAvailable({
      organizationId: input.role.organizationId,
      name: input.role.name,
    });

    const roleId = generate(ROLE_KSUID_RESOURCE).toString();
    const description = input.role.description ?? null;
    await this.#permissions.defineRole({
      organizationId: input.role.organizationId,
      roleId,
      name: input.role.name,
      ...(description === null ? {} : { description }),
      permissions: input.role.permissions,
      kind: ROLE_KIND.CUSTOM,
      actor: actorOf(by),
      requireProjection: false,
    });

    const now = toDate(nowInstant());

    return {
      id: roleId,
      organizationId: input.role.organizationId,
      name: input.role.name,
      description,
      permissions: input.role.permissions,
      kind: ROLE_KIND.CUSTOM,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Rewrites a role's name, description or permission set. */
  async updateRole(
    input: { roleId: string; changes: RoleUpdate },
    by: RoleUserCaller,
  ): Promise<Role> {
    const role = await this.#roles.getById({ roleId: input.roleId });
    await this.#assertMayReach(by, role.organizationId, "organization:manage");
    await this.#plan.assertCustomRolesAllowed({ organizationId: role.organizationId });

    return this.#write(role, input.changes, by);
  }

  /** The same rewrite, inside an organization the credential already resolved. */
  async updateRoleInOrganization(
    input: { roleId: string; organizationId: string; changes: RoleUpdate },
    by: RoleCaller,
  ): Promise<Role> {
    const role = await this.#roles.getInOrganization({
      roleId: input.roleId,
      organizationId: input.organizationId,
    });

    return this.#write(role, input.changes, by);
  }

  /** Deletes a custom role nothing holds. */
  async deleteRole(input: { roleId: string }, by: RoleUserCaller): Promise<RoleWriteAcknowledged> {
    const role = await this.#roles.getById(input);
    await this.#assertMayReach(by, role.organizationId, "organization:manage");

    return this.#delete({ roleId: role.id, organizationId: role.organizationId }, by);
  }

  /** The same deletion, inside an organization the credential already resolved. */
  async deleteRoleInOrganization(
    input: { roleId: string; organizationId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged> {
    await this.#roles.getInOrganization(input);

    return this.#delete(input, by);
  }

  /** Gives one user a custom role on one team. */
  async assignRoleToUser(
    input: { userId: string; teamId: string; customRoleId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged> {
    // The team's organization first, so a team nobody can name reads as a
    // not-found rather than as a plan refusal.
    const organizationId = await this.getAssignmentOrganization({ teamId: input.teamId });
    await this.#plan.assertCustomRolesAllowed({ organizationId });

    const role = await this.#roles.getById({ roleId: input.customRoleId });
    if (role.organizationId !== organizationId) throw new RoleNotAssignableError();

    const exclusive = role.permissions.find(
      (permission) => !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission }),
    );
    if (exclusive) throw new OrgExclusivePermissionScopeError(exclusive, "TEAM");

    if (!(await this.#isOnTeam({ ...input, organizationId }))) {
      throw new RoleUserNotTeamMemberError();
    }

    await this.#scope.assertNoPersonalTeamScope({
      scopes: [{ scopeType: "TEAM", scopeId: input.teamId }],
    });
    await this.#replaceTeamBinding({
      userId: input.userId,
      teamId: input.teamId,
      organizationId,
      customRoleId: input.customRoleId,
      actor: actorOf(by),
    });

    return WRITE_ACKNOWLEDGED;
  }

  /** Takes a user's custom role on one team away again. */
  async removeRoleFromUser(
    input: { userId: string; teamId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged> {
    const organizationId = await this.getAssignmentOrganization({ teamId: input.teamId });
    await this.#scope.assertNoPersonalTeamScope({
      scopes: [{ scopeType: "TEAM", scopeId: input.teamId }],
    });
    await this.#replaceTeamBinding({
      userId: input.userId,
      teamId: input.teamId,
      organizationId,
      customRoleId: null,
      actor: actorOf(by),
    });

    return WRITE_ACKNOWLEDGED;
  }

  /** The organization a team assignment lands in. */
  async getAssignmentOrganization(input: { teamId: string }): Promise<string> {
    const organizationId = await this.#organizations.tryGetOrganizationIdByTeamId(input);
    if (!organizationId) throw new RoleTeamNotFoundError(input.teamId);

    return organizationId;
  }

  /** Of the listed ids, the ones this organization may actually assign. */
  filterAssignableRoles(input: { roleIds: string[]; organizationId: string }): Promise<string[]> {
    return this.#roles.filterAssignable(input);
  }

  /** The catalog a custom role is written from. */
  async getPermissionCatalog(): Promise<RolePermissionCatalog> {
    const actions = [...ROLE_PERMISSION_ACTIONS];

    return {
      resources: ROLE_PERMISSION_RESOURCES.map((resource) => ({
        resource,
        organizationExclusive: roleResourceIsOrganizationExclusive(resource),
        actions,
        permissions: actions.map((action) => `${resource}:${action}`),
      })),
      actions,
    };
  }

  // ── role bindings ──────────────────────────────────────────────────────────

  /** Every role binding in the organization, for the members administration screen. */
  listBindingsForOrganization(input: {
    organizationId: string;
  }): Promise<AuthzListManagedBindingsForOrganizationOutput> {
    return this.#permissions.listManagedBindingsForOrganization(input);
  }

  /** One user's role bindings, for the member detail dialog. */
  listBindingsForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzListManagedBindingsForUserOutput> {
    return this.#permissions.listManagedBindingsForUser(input);
  }

  /**
   * The caller's own standing. The display identity is read through the user
   * directory rather than off a session, because a handler is handed a caller
   * id and nothing else.
   */
  async getCallerAccessBreakdown(
    input: { organizationId: string },
    by: RoleUserCaller,
  ): Promise<AuthzAccessBreakdownOutput> {
    const profile = await this.#users.tryFindById({ id: by.id });

    return this.#permissions.getAccessBreakdown({
      organizationId: input.organizationId,
      userId: by.id,
      userName: profile?.name ?? null,
      userEmail: profile?.email ?? null,
    });
  }

  /** Binds a user or a group to a role at one scope. */
  createBinding(
    input: Omit<AuthzCreateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput> {
    return this.#permissions.createBinding({ ...input, actor: actorOf(by) });
  }

  /** Changes the role an existing binding grants. */
  updateBinding(
    input: Omit<AuthzUpdateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput> {
    return this.#permissions.updateBinding({ ...input, actor: actorOf(by) });
  }

  /** Removes one binding by id. */
  deleteBinding(
    input: Omit<AuthzDeleteBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess> {
    return this.#permissions.deleteBinding({ ...input, actor: actorOf(by) });
  }

  /**
   * Applies one member's deletes and creates together, so a partial failure
   * cannot leave them holding some of the old bindings and none of the new.
   */
  applyMemberBindings(
    input: Omit<AuthzApplyMemberBindingsInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess> {
    return this.#permissions.applyMemberBindings({ ...input, actor: actorOf(by) });
  }

  // ── the checks and writes the operations above share ───────────────────────

  /** The organization decision an input could not name, run where the row is. */
  async #assertMayReach(
    by: RoleUserCaller,
    organizationId: string,
    permission: "organization:view" | "organization:manage",
  ): Promise<void> {
    const permitted = await this.#permissions.hasPermission({
      userId: by.id,
      permission,
      organizationId,
    });

    if (permitted) return;

    throw new PermissionDeniedError({
      permission,
      scope: { type: "organization", id: organizationId },
      denialReason: "no-binding",
    });
  }

  async #write(current: Role, changes: RoleUpdate, by: RoleCaller): Promise<Role> {
    this.#roles.assertNameAllowed(changes.name);
    const name = changes.name ?? current.name;
    if (name !== current.name) {
      await this.#roles.assertNameAvailable({
        organizationId: current.organizationId,
        name,
        exceptRoleId: current.id,
      });
    }

    const description = changes.description === void 0 ? current.description : changes.description;
    const permissions = changes.permissions ?? current.permissions;
    await this.#permissions.defineRole({
      organizationId: current.organizationId,
      roleId: current.id,
      name,
      ...(description === null ? {} : { description }),
      permissions,
      kind: current.kind,
      actor: actorOf(by),
    });

    return { ...current, name, description, permissions, updatedAt: toDate(nowInstant()) };
  }

  /**
   * The guarded deletion: refuse a role anything still holds, then look again
   * before writing, so a holder that appeared in between loses rather than
   * being deleted out from under.
   */
  async #delete(
    input: { roleId: string; organizationId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged> {
    const held = await this.#countHolders(input);
    if (held.userCount > 0 || held.bindingCount > 0) throw new RoleInUseError(held);

    const stillDefined = await this.#roles.getInOrganization(input);
    const heldNow = await this.#countHolders(input);
    if (heldNow.userCount > 0 || heldNow.bindingCount > 0) throw new RoleInUseError(heldNow);

    await this.#permissions.deleteRole({
      organizationId: input.organizationId,
      roleId: stillDefined.id,
      actor: actorOf(by),
    });

    return WRITE_ACKNOWLEDGED;
  }

  async #countHolders(input: {
    roleId: string;
    organizationId: string;
  }): Promise<{ userCount: number; bindingCount: number }> {
    const [userCount, bindings] = await Promise.all([
      this.#roles.countAssignedUsers({ roleId: input.roleId }),
      this.#permissions.listOrganizationBindings({ organizationId: input.organizationId }),
    ]);

    return {
      userCount,
      bindingCount: bindings.filter((binding) => binding.customRoleId === input.roleId).length,
    };
  }

  async #isOnTeam(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<boolean> {
    const bindings = await this.#permissions.listUserBindings({
      userId: input.userId,
      organizationId: input.organizationId,
    });

    return bindings.some(
      (binding) => binding.scopeType === "TEAM" && binding.scopeId === input.teamId,
    );
  }

  /** One team binding rewritten in place, or attached where there was none. */
  async #replaceTeamBinding(input: {
    userId: string;
    teamId: string;
    organizationId: string;
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void> {
    const role = input.customRoleId ? "CUSTOM" : "VIEWER";
    const bindings = await this.#permissions.listUserBindings({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const existing = bindings.find(
      (binding) =>
        binding.userId === input.userId &&
        binding.scopeType === "TEAM" &&
        binding.scopeId === input.teamId,
    );

    if (existing) {
      await this.#permissions.changeBindingRole({
        organizationId: input.organizationId,
        bindingId: existing.id,
        role,
        customRoleId: input.customRoleId,
        actor: input.actor,
      });

      return;
    }

    await this.#permissions.attachBindings({
      organizationId: input.organizationId,
      bindings: [
        {
          bindingId: this.#bindingIds.newBindingId(),
          principal: { userId: input.userId },
          role,
          customRoleId: input.customRoleId,
          scopeType: "TEAM",
          scopeId: input.teamId,
        },
      ],
      actor: input.actor,
      onDuplicate: "skip",
    });
  }
}

/**
 * The one place a caller becomes a durable ledger actor for this feature. The
 * `managementApi` fallback names who acted when no person did.
 */
function actorOf(by: RoleCaller): LedgerActor {
  return ledgerActorFor({ userId: by.id, fallback: "managementApi" });
}

function permissionsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((permission): permission is string => typeof permission === "string")
    : [];
}
