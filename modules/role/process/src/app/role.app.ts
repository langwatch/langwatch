/**
 * The role feature's application: two tRPC namespaces and one REST family reach
 * this one object. Three operations name a ROLE rather than the organization
 * their check runs against, so those checks run here, where the row is.
 */
import { ledgerActorFor, type LedgerActor, PermissionDeniedError } from "@langwatch/authorization";
import {
  AuthzApi,
  bindingScopeCanGrantPermission,
  builtInRoleIdSchema,
  builtinRolePermissions,
  newAuthzGrantId,
  type AuthzPrincipalRef,
  type BuiltInRoleId,
  type GrantScopeTier,
} from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { generate } from "@langwatch/ksuid";
import {
  OrganizationApi,
  PersonalWorkspaceNotManagedHereError,
  OrganizationNotFoundForTeamError,
} from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { type MembersRead } from "@langwatch/process-stores/members";
import {
  OrgExclusivePermissionScopeError,
  RoleApi,
  RoleExceedsCallerPermissionsError,
  RoleInUseError,
  RoleIsBuiltInError,
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
  type RoleCaller,
  type RoleCreate,
  type RolePermissionCatalog,
  type RoleUpdate,
  type RoleUserCaller,
  type RoleWriteAcknowledged,
} from "@langwatch/role-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type { RoleRepositories } from "../repositories/role.repositories.ts";
import { RoleService } from "../services/role.service.ts";

type RoleSetup = FeatureSetup<
  typeof RoleApp.dependencies,
  MembersRead<typeof RoleApp.reads>,
  undefined,
  RoleRepositories
>;

const WRITE_ACKNOWLEDGED: RoleWriteAcknowledged = { success: true };

export class RoleApp implements RoleApi {
  static readonly contract = RoleApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    organizations: OrganizationApi,
    entitlement: EntitlementApi,
  };
  static readonly reads = ["prisma"] as const;

  #roles: RoleService;
  #permissions: AuthzApi;
  #organizations: OrganizationApi;
  #prisma: RoleSetup["members"]["prisma"];

  private constructor(
    repositories: RoleRepositories,
    dependencies: RoleSetup["dependencies"],
    members: RoleSetup["members"],
  ) {
    this.#roles = RoleService.create({
      repository: repositories.roles,
      entitlement: dependencies.entitlement,
    });
    this.#permissions = dependencies.permissions;
    this.#organizations = dependencies.organizations;
    this.#prisma = members.prisma;
  }

  static create({ repositories, dependencies, members }: RoleSetup): RoleApp {
    return new RoleApp(repositories, dependencies, members);
  }

  // ── custom roles ───────────────────────────────────────────────────────────

  /** The built-in roles, then the custom ones the ledger projects, narrowed by `builtIn`. */
  async listRoles(input: { organizationId: string; builtIn?: boolean }): Promise<Role[]> {
    const builtIn =
      input.builtIn === false
        ? []
        : builtInRoleIdSchema.options.map((roleId) =>
            builtInRole({ roleId, organizationId: input.organizationId }),
          );
    if (input.builtIn === true) return builtIn;

    const roles = await this.#permissions.listUserCreatedRoles({
      organizationId: input.organizationId,
    });

    return [
      ...builtIn,
      ...roles.map((role) =>
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
      ),
    ];
  }

  /** One custom role, for a caller who may view the organization that owns it. */
  async getRole(input: { roleId: string }, by: RoleUserCaller): Promise<Role> {
    const role = await this.#roles.getById(input);
    await this.#assertMayReach(by, role.organizationId, "organization:view");

    return role;
  }

  /** A built-in id, or one custom role inside an organization the credential resolved. */
  async getRoleInOrganization(input: { roleId: string; organizationId: string }): Promise<Role> {
    const builtIn = builtInRoleIdSchema.safeParse(input.roleId);
    if (builtIn.success) {
      return builtInRole({ roleId: builtIn.data, organizationId: input.organizationId });
    }

    return this.#roles.getInOrganization(input);
  }

  /** Defines a custom role, attributed to the caller who asked for it. */
  async createRole(input: { role: RoleCreate }, by: RoleCaller): Promise<Role> {
    this.#roles.assertNameAllowed(input.role.name);
    await this.#assertWithinCaller({
      organizationId: input.role.organizationId,
      added: input.role.permissions,
      by,
    });
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
      requireProjection: true,
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
    await this.#roles.assertCustomRolesAllowed({ organizationId: role.organizationId });

    return this.#write(role, input.changes, by);
  }

  /** The same rewrite, inside an organization the credential already resolved. */
  async updateRoleInOrganization(
    input: { roleId: string; organizationId: string; changes: RoleUpdate },
    by: RoleCaller,
  ): Promise<Role> {
    assertNotBuiltIn(input.roleId);
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
    assertNotBuiltIn(input.roleId);
    await this.#roles.getInOrganization(input);

    return this.#delete(input, by);
  }

  /** Gives one user a custom role on one team. */
  async assignRoleToUser(
    input: { userId: string; teamId: string; customRoleId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged> {
    const organizationId = await this.getAssignmentOrganization({ teamId: input.teamId });

    const role = await this.#roles.getById({ roleId: input.customRoleId });
    if (role.organizationId !== organizationId) throw new RoleNotAssignableError();

    // A legacy `ops:*` entry is inert at every tier (the platform fence), so it refuses nothing.
    const exclusive = role.permissions.find(
      (permission) =>
        bindingScopeCanGrantPermission({ scopeType: "ORGANIZATION", permission }) &&
        !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission }),
    );
    if (exclusive) throw new OrgExclusivePermissionScopeError(exclusive, "TEAM");

    if (!(await this.#isOnTeam({ ...input, organizationId }))) {
      throw new RoleUserNotTeamMemberError();
    }

    await this.#assertNoPersonalTeamScope([{ scopeType: "TEAM", scopeId: input.teamId }]);
    await this.#replaceTeamBinding({
      userId: input.userId,
      teamId: input.teamId,
      organizationId,
      customRoleId: input.customRoleId,
      caller: callerOf(by),
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
    await this.#assertNoPersonalTeamScope([{ scopeType: "TEAM", scopeId: input.teamId }]);
    await this.#replaceTeamBinding({
      userId: input.userId,
      teamId: input.teamId,
      organizationId,
      customRoleId: null,
      caller: callerOf(by),
      actor: actorOf(by),
    });

    return WRITE_ACKNOWLEDGED;
  }

  /** The organization a team assignment lands in. */
  async getAssignmentOrganization(input: { teamId: string }): Promise<string> {
    try {
      return await this.#organizations.getOrganizationIdByTeamId(input);
    } catch (error) {
      if (OrganizationNotFoundForTeamError.is(error)) throw new RoleTeamNotFoundError(input.teamId);
      throw error;
    }
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

  // ── the checks and writes the operations above share ───────────────────────

  /** The personal-workspace fence a team or project binding is refused at. */
  async #assertNoPersonalTeamScope(
    scopes: { scopeType: GrantScopeTier; scopeId: string }[],
  ): Promise<void> {
    const teamIds = scopes
      .filter((scope) => scope.scopeType === "TEAM")
      .map((scope) => scope.scopeId);
    const projectIds = scopes
      .filter((scope) => scope.scopeType === "PROJECT")
      .map((scope) => scope.scopeId);
    const personalTeam = await this.#prisma.team.findFirst({
      where: { id: { in: teamIds }, isPersonal: true },
      select: { name: true },
    });
    const personalProject = await this.#prisma.project.findFirst({
      where: {
        id: { in: projectIds },
        OR: [{ isPersonal: true }, { team: { isPersonal: true } }],
      },
      select: { team: { select: { name: true } } },
    });
    const personalName = personalTeam?.name ?? personalProject?.team.name;
    if (personalName) throw new PersonalWorkspaceNotManagedHereError(personalName);
  }

  /**
   * A role never gains a permission its writer lacks on the organization. Only ADDED ones are
   * asked, so a role may keep what its writer cannot grant; widening a role the writer holds
   * is refused the same way, since holding it cannot supply what they lacked.
   */
  async #assertWithinCaller({
    organizationId,
    added,
    by,
  }: {
    organizationId: string;
    added: readonly string[];
    by: RoleCaller;
  }): Promise<void> {
    const missing = await this.#permissions.findPermissionsBeyondCaller({
      organizationId,
      caller: callerOf(by),
      scope: { type: "organization", id: organizationId },
      permissions: [...added],
    });
    if (missing.length > 0) throw new RoleExceedsCallerPermissionsError(missing);
  }

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
    const kept = new Set(current.permissions);
    await this.#assertWithinCaller({
      organizationId: current.organizationId,
      added: (changes.permissions ?? []).filter((permission) => !kept.has(permission)),
      by,
    });
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
      kind: ROLE_KIND.CUSTOM,
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
    caller: AuthzPrincipalRef;
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
        caller: input.caller,
        actor: input.actor,
      });

      return;
    }

    await this.#permissions.attachBindings({
      organizationId: input.organizationId,
      bindings: [
        {
          bindingId: newAuthzGrantId(),
          principal: { userId: input.userId },
          role,
          customRoleId: input.customRoleId,
          scopeType: "TEAM",
          scopeId: input.teamId,
        },
      ],
      caller: input.caller,
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

/** Whose permissions bound a write: the key it arrived on, else the person. */
function callerOf(by: RoleCaller): AuthzPrincipalRef {
  if (by.apiKeyId) return { type: "apiKey", id: by.apiKeyId };
  if (by.id) return { type: "user", id: by.id };

  return { type: "anonymous" };
}

function assertNotBuiltIn(roleId: string): void {
  if (builtInRoleIdSchema.validate(roleId)) throw new RoleIsBuiltInError(roleId);
}

const BUILT_IN_ROLE_NAME: Readonly<Record<BuiltInRoleId, string>> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function builtInRole(input: { roleId: BuiltInRoleId; organizationId: string }): Role {
  return {
    id: input.roleId,
    organizationId: input.organizationId,
    name: BUILT_IN_ROLE_NAME[input.roleId],
    description: null,
    permissions: [...builtinRolePermissions(input.roleId)],
    kind: ROLE_KIND.BUILT_IN,
    createdAt: null,
    updatedAt: null,
  };
}

function permissionsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((permission): permission is string => typeof permission === "string")
    : [];
}
