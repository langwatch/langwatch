/**
 * The role feature's application: what its doors call.
 *
 * Two tRPC doors answer for this feature — `role.*` (the custom-role
 * definitions) and `roleBinding.*` (who holds one, and where) — and before
 * this each declared its own private bag: `Readonly<{ roles: RoleService }>`
 * in one and `Readonly<{ permissions: AuthzService; authzGrants:
 * AuthzGrantsService }>` in the other. Two descriptions of one composition,
 * agreeing by attention rather than by construction, and neither reachable
 * from the other.
 *
 * Most operations are the services' own. What lives here as a method is what a
 * door would otherwise have to know: attributing a write to its caller. Nine
 * handlers stamped it for themselves, and — the reason this matters — they did
 * it two different ways: `ledgerActorFor({ userId, fallback: "managementApi" })`
 * in one file and a hand-rolled `{ type: "user", id }` in the other. They agree
 * today only because a signed-in caller always has an id; the first time one
 * of them learns about a second kind of caller, they stop agreeing. There is
 * one construction now, and it is here.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import { ledgerActorFor, type LedgerActor } from "@langwatch/actor";
import type {
  AuthzAccessBreakdownOutput,
  AuthzApplyMemberBindingsInput,
  AuthzBindingMutationSuccess,
  AuthzCreateBindingInput,
  AuthzCreateBindingOutput,
  AuthzDeleteBindingInput,
  AuthzGrantsService,
  AuthzListManagedBindingsForOrganizationOutput,
  AuthzListManagedBindingsForUserOutput,
  AuthzService,
  AuthzUpdateBindingInput,
} from "@langwatch/authz-contract";
import type { Role, RoleCreate, RoleService, RoleUpdate } from "@langwatch/role-contract";

/** Who a write is attributed to. */
export interface RoleCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface RoleAppDependencies {
  roles: RoleService;
  permissions: AuthzService;
  authzGrants: AuthzGrantsService;
}

export class RoleApp {
  static create(dependencies: RoleAppDependencies): RoleApp {
    return new RoleApp(dependencies);
  }

  private constructor(private readonly dependencies: RoleAppDependencies) {}

  // ── custom roles ───────────────────────────────────────────────────────────

  /** Every custom role defined in the organization. */
  listRoles(input: Readonly<{ organizationId: string }>): Promise<Role[]> {
    return this.dependencies.roles.list(input);
  }

  /** One custom role by id. */
  getRole(input: Readonly<{ roleId: string }>): Promise<Role> {
    return this.dependencies.roles.get(input);
  }

  /** Defines a custom role, attributed to the caller who asked for it. */
  createRole(
    input: Readonly<{ role: RoleCreate }>,
    by: RoleCaller,
  ): Promise<Role> {
    return this.dependencies.roles.create({ role: input.role, actor: this.actorFor(by) });
  }

  /** Rewrites a custom role's name, description or permission set. */
  updateRole(
    input: Readonly<{ roleId: string; changes: RoleUpdate }>,
    by: RoleCaller,
  ): Promise<Role> {
    return this.dependencies.roles.update({
      roleId: input.roleId,
      changes: input.changes,
      actor: this.actorFor(by),
    });
  }

  /** Deletes a custom role. */
  deleteRole(
    input: Readonly<{ roleId: string }>,
    by: RoleCaller,
  ): Promise<{ success: true }> {
    return this.dependencies.roles.remove({ roleId: input.roleId, actor: this.actorFor(by) });
  }

  /** Gives one user a custom role on one team. */
  assignRoleToUser(
    input: Readonly<{ userId: string; teamId: string; customRoleId: string }>,
    by: RoleCaller,
  ): Promise<{ success: true }> {
    return this.dependencies.roles.assignToUser({ ...input, actor: this.actorFor(by) });
  }

  /** Takes a user's custom role on one team away again. */
  removeRoleFromUser(
    input: Readonly<{ userId: string; teamId: string }>,
    by: RoleCaller,
  ): Promise<{ success: true }> {
    return this.dependencies.roles.removeFromUser({ ...input, actor: this.actorFor(by) });
  }

  /**
   * The organization a team assignment lands in.
   *
   * Read here rather than off the team, because an assignment is refused for a
   * team nobody can name — the service raises `TeamNotFoundError`, which the
   * door renders as a 404 — and the plan that governs custom roles is read per
   * organization. A door that resolved the organization some other way would
   * be answering the plan question about a team it had not established exists.
   */
  getAssignmentOrganization(input: Readonly<{ teamId: string }>): Promise<string> {
    return this.dependencies.roles.getAssignmentOrganization(input);
  }

  // ── role bindings ──────────────────────────────────────────────────────────

  /**
   * Every role binding in the organization.
   *
   * Audit-grade RBAC data — every binding's users, groups, scope ids and names
   * — so the door that exposes it stays gated at `organization:manage`.
   */
  listBindingsForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<AuthzListManagedBindingsForOrganizationOutput> {
    return this.dependencies.permissions.listManagedBindingsForOrganization(input);
  }

  /** One user's role bindings, for the member detail dialog. */
  listBindingsForUser(
    input: Readonly<{ organizationId: string; userId: string }>,
  ): Promise<AuthzListManagedBindingsForUserOutput> {
    return this.dependencies.permissions.listManagedBindingsForUser(input);
  }

  /**
   * The caller's own full RBAC breakdown: organization role, groups and their
   * bindings, direct bindings, each with the permissions it resolves to.
   *
   * The display identity is passed in rather than read here, because it is the
   * caller's session that knows it and this application never reads a session.
   */
  getCallerAccessBreakdown(
    input: Readonly<{
      organizationId: string;
      userName: string | null;
      userEmail: string | null;
    }>,
    by: RoleCaller,
  ): Promise<AuthzAccessBreakdownOutput> {
    return this.dependencies.permissions.getAccessBreakdown({
      organizationId: input.organizationId,
      userId: by.id,
      userName: input.userName,
      userEmail: input.userEmail,
    });
  }

  /** Binds a user or a group to a role at one scope. */
  createBinding(
    input: Omit<AuthzCreateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput> {
    return this.dependencies.authzGrants.createBinding({ ...input, actor: this.actorFor(by) });
  }

  /** Changes the role an existing binding grants. */
  updateBinding(
    input: Omit<AuthzUpdateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput> {
    return this.dependencies.authzGrants.updateBinding({ ...input, actor: this.actorFor(by) });
  }

  /** Removes one binding by id. */
  deleteBinding(
    input: Omit<AuthzDeleteBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess> {
    return this.dependencies.authzGrants.deleteBinding({ ...input, actor: this.actorFor(by) });
  }

  /**
   * Applies a batch of binding deletes and creates for one user atomically, so
   * a partial failure cannot leave them holding some of the old bindings and
   * none of the new ones.
   */
  applyMemberBindings(
    input: Omit<AuthzApplyMemberBindingsInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess> {
    return this.dependencies.authzGrants.applyMemberBindings({
      ...input,
      actor: this.actorFor(by),
    });
  }

  /**
   * The one place a caller becomes a durable ledger actor for this feature.
   *
   * The `managementApi` fallback names who acted when no person did — the
   * management API acting on its own credential — and it is written once here
   * rather than at each of the nine write sites that used to build an actor.
   */
  private actorFor(by: RoleCaller): LedgerActor {
    return ledgerActorFor({ userId: by.id, fallback: "managementApi" });
  }
}
