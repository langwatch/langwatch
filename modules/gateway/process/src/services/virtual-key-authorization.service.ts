import { type AuthzPermission, PermissionDeniedError } from "@langwatch/authorization";
import type { VirtualKeyWithScopes, GuardrailAttachment } from "@langwatch/gateway-contract";
import {
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GuardrailAttachForbiddenError,
  VirtualKeyNotFoundError,
} from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { GatewayScopePermissions } from "../app/gateway.members.ts";
import type { VirtualKeyAuthorizationRepository } from "../repositories/virtual-key-authorization.repository.ts";
import { isMemberNotFound } from "../rules/gateway-organization-peer.rules.ts";
import type { VirtualKeyService } from "./virtual-key.service.ts";

/**
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 * Scope-aware authorization for virtual-key write paths. Creation authorizes against the requested
 * scopes, needing manage on every one; the other writes authorize against the existing scopes.
 */
export type VirtualKeySessionActor = { user: { id: string } } | null;

export type RBACContext = {
  session: VirtualKeySessionActor;
  permissions: GatewayScopePermissions;
};

export type Scope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Identity a key write is authorized as, for both doors: a session (role cascade), a scoped API
 * key (key and user at each scope), a legacy project key or a project-bound access token (the
 * person), both confined to their own project (ARCHITECTURE.md §1830).
 */
export type VirtualKeyActor =
  | { kind: "session"; session: VirtualKeySessionActor }
  | {
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
    }
  | { kind: "legacyProjectKey"; projectId: string }
  | { kind: "cliAccessToken"; userId: string; projectId: string };

export type ActorContext = {
  actor: VirtualKeyActor;
  /** The one authorization seam. See {@link GatewayScopePermissions}. */
  permissions: GatewayScopePermissions;
};

/** A key's scopes as given (or read from the stored key when absent) and its trace destination. */
export type GuardrailProjectKey = {
  organizationId: string;
  vkId: string | null;
  inputScopes: { scopeType: string; scopeId: string }[] | undefined;
  traceProjectId?: string | null;
};

const AUTHZ_TIER = {
  ORGANIZATION: "organization",
  TEAM: "team",
  PROJECT: "project",
} as const satisfies Record<Scope["scopeType"], "organization" | "team" | "project">;

/** The one denial error (ADR-092 §2), at the scope the grant was missing from. */
function permissionDenied(permission: AuthzPermission, scope: Scope | undefined) {
  return new PermissionDeniedError({
    permission,
    scope: scope
      ? { type: AUTHZ_TIER[scope.scopeType], id: scope.scopeId }
      : { type: "organization", id: "" },
    denialReason: "no-binding",
  });
}

/**
 * Whether a seat takes part in the organization's shared gateway keys. The seat is the gate
 * because neither restricted seat holds a binding at the organization scope, so no permission
 * check can tell them apart from a Full member who lacks `virtualKeys:view` there.
 */
function seatSharesOrganizationKeys(role: string): boolean {
  return role !== "DEVELOPER" && role !== "EXTERNAL";
}

/**
 * Scopes a user reaches by membership within one org. List and read visibility is membership-based
 * rather than permission-based: a key is visible when one of its scopes intersects this set, so a
 * plain org member sees org-scoped keys and a team member sees that team's but not a sibling's.
 */
export type MembershipSet = {
  /**
   * Holds an active seat that shares in the org's keys: a Full seat or an administrator. A Lite
   * Member sees no gateway page and a Developer (ADR-171) nothing shared, so neither sees an
   * organization-scoped key through membership alone.
   */
  isOrgMember: boolean;
  /**
   * Caller is an org-level admin, so visibility short-circuits to everything in the org: real org
   * owners hold no per-team rows and would otherwise be blind to the per-project auto-provisioned
   * key they own.
   */
  isOrgAdmin: boolean;
  teamIds: Set<string>;
  projectIds: Set<string>;
};

/**
 * Every id must come back from an org-scoped lookup: an id naming another tenant's row simply does
 * not match the where clause, so absence from the result is the refusal and the query never has to
 * compare tenants itself.
 */
async function assertAllResolve(
  scopeType: string,
  ids: string[],
  lookup: (ids: string[]) => Promise<string[]>,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const found = new Set(await lookup(ids));
  if (ids.some((id) => !found.has(id))) {
    throw new GatewayScopeOrgMismatchError(scopeType);
  }
}

/** A virtual-key loader. Structurally satisfied by {@link VirtualKeyService}. */
export type VirtualKeyReader = Pick<VirtualKeyService, "findById">;

/**
 * Scope-aware authorization for the virtual-key write paths. Every call names
 * the context it authorizes against, so both doors into the service layer
 * enforce one vocabulary.
 */
export class VirtualKeyAuthorizationService {
  static create(input: {
    directory: VirtualKeyAuthorizationRepository;
    organizations: Pick<OrganizationApi, "getMember" | "findMemberTeamIds">;
    projects: Pick<ProjectApi, "findIdentity" | "listIdsByOrganization">;
  }): VirtualKeyAuthorizationService {
    return new VirtualKeyAuthorizationService(input.directory, input.organizations, input.projects);
  }

  private constructor(
    private readonly directory: VirtualKeyAuthorizationRepository,
    private readonly organizations: Pick<OrganizationApi, "getMember" | "findMemberTeamIds">,
    private readonly projects: Pick<ProjectApi, "findIdentity" | "listIdsByOrganization">,
  ) {}

  /** The role an enabled member holds here; none for a stranger or a disabled seat. */
  private async enabledRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: string } | null> {
    try {
      const member = await this.organizations.getMember(input);

      return member.disabledAt === null ? { role: member.role } : null;
    } catch (error) {
      if (isMemberNotFound(error)) return null;

      throw error;
    }
  }

  /** Of the named projects, those inside this organization. */
  private async projectIdsInOrganization(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<string[]> {
    const inOrganization = new Set(
      await this.projects.listIdsByOrganization({ organizationId: input.organizationId }),
    );

    return input.projectIds.filter((id) => inOrganization.has(id));
  }

  private async actorHasPermissionAtScope(
    ctx: ActorContext,
    scope: Scope,
    permission: AuthzPermission,
  ): Promise<boolean> {
    const { actor } = ctx;
    switch (actor.kind) {
      case "session": {
        if (!actor.session) {
          return false;
        }

        const scopeRef = await this.scopeRefFor(scope);
        if (!scopeRef) {
          return false;
        }

        return ctx.permissions.sessionHolds({
          userId: actor.session.user.id,
          permission,
          scope: scopeRef,
        });
      }
      case "apiKey": {
        const scopeRef = await this.scopeRefFor(scope);
        if (!scopeRef) {
          return false;
        }

        return ctx.permissions.apiKeyHolds({
          apiKeyId: actor.apiKeyId,
          userId: actor.userId,
          organizationId: actor.organizationId,
          scope: scopeRef,
          permission,
        });
      }
      case "legacyProjectKey":
        // Full access at the key's own project (the historical contract for
        // project keys), nothing at any other scope. Broader provisioning
        // requires a scoped API key with the bindings to prove it.
        return scope.scopeType === "PROJECT" && scope.scopeId === actor.projectId;
      case "cliAccessToken": {
        if (scope.scopeType !== "PROJECT" || scope.scopeId !== actor.projectId) return false;
        const scopeRef = await this.scopeRefFor(scope);
        if (!scopeRef) return false;

        return ctx.permissions.sessionHolds({ userId: actor.userId, permission, scope: scopeRef });
      }
    }
  }

  /** Map a VK scope row onto the role-binding resolver's scope reference. */
  private async scopeRefFor(
    scope: Scope,
  ): Promise<
    | { type: "org"; id: string }
    | { type: "team"; id: string }
    | { type: "project"; id: string; teamId: string }
    | null
  > {
    if (scope.scopeType === "ORGANIZATION") {
      return { type: "org", id: scope.scopeId };
    }

    if (scope.scopeType === "TEAM") {
      return { type: "team", id: scope.scopeId };
    }

    const project = await this.projects.findIdentity(scope.scopeId);
    // Fail closed on a dangling project reference.
    if (!project) {
      return null;
    }

    return { type: "project", id: project.id, teamId: project.teamId };
  }

  /**
   * Create gate: require `virtualKeys:manage` on every requested scope.
   * Throws permission_denied at the first unauthorized scope so the caller sees
   * exactly which grant is missing.
   */
  async assertActorCanManageAllScopes(ctx: ActorContext, scopes: Scope[]): Promise<void> {
    // Deny on an empty list rather than falling through the loop: "the caller
    // controls every scope in {}" is vacuously true, which would make this gate
    // the one permission check in the file that grants by default. Its sibling
    // `assertActorCanOperateOnAnyScope` already denies an empty list, and two
    // gates in one file with opposite empty-input answers is the trap.
    if (scopes.length === 0 || (ctx.actor.kind === "session" && !ctx.actor.session)) {
      throw permissionDenied("virtualKeys:manage", scopes[0]);
    }

    for (const scope of scopes) {
      if (!(await this.actorHasPermissionAtScope(ctx, scope, "virtualKeys:manage"))) {
        throw permissionDenied("virtualKeys:manage", scope);
      }
    }
  }

  /**
   * Create gate for a project credential: a key for exactly its own project
   * needs `virtualKeys:create` there; any wider scope needs manage everywhere.
   */
  async assertActorCanCreateScopes(
    ctx: ActorContext,
    { scopes, callerProjectId }: { scopes: Scope[]; callerProjectId: string },
  ): Promise<void> {
    const [only] = scopes;
    const ownProjectOnly =
      scopes.length === 1 &&
      only !== undefined &&
      only.scopeType === "PROJECT" &&
      only.scopeId === callerProjectId;
    if (!ownProjectOnly) {
      return this.assertActorCanManageAllScopes(ctx, scopes);
    }

    if (
      (ctx.actor.kind === "session" && !ctx.actor.session) ||
      !(await this.actorHasPermissionAtScope(ctx, only, "virtualKeys:create"))
    ) {
      throw permissionDenied("virtualKeys:create", only);
    }
  }

  /**
   * Change gate (update, re-scope, rotate, disable, enable, revoke): the op permission at EVERY
   * scope the key covers (Alex, 2026-10-01), so a caller confined to one project changes only
   * keys scoped to that project alone. Throws permission_denied at the first scope it lacks.
   */
  async assertActorCanOperateOnAnyScope(
    ctx: ActorContext,
    scopes: Scope[],
    permission: AuthzPermission,
  ): Promise<void> {
    if (scopes.length === 0) throw permissionDenied(permission, undefined);

    for (const scope of scopes) {
      if (!(await this.actorHasPermissionAtScope(ctx, scope, permission))) {
        throw permissionDenied(permission, scope);
      }
    }
  }

  /**
   * Gate for an organization-owned gateway row (budgets, cache rules). A legacy
   * project key passes, as on main: it carries full access by its class alone.
   */
  async assertActorCanOperateAtOrganization(
    ctx: ActorContext,
    { organizationId, permission }: { organizationId: string; permission: AuthzPermission },
  ): Promise<void> {
    if (ctx.actor.kind === "legacyProjectKey") return;

    await this.assertActorCanOperateOnAnyScope(
      ctx,
      [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      permission,
    );
  }

  /** Session-shaped wrapper over {@link assertActorCanManageAllScopes}. */
  async assertCanManageAllScopes(ctx: RBACContext, scopes: Scope[]): Promise<void> {
    return this.assertActorCanManageAllScopes(
      { actor: { kind: "session", session: ctx.session }, permissions: ctx.permissions },
      scopes,
    );
  }

  /** Session-shaped wrapper over {@link assertActorCanOperateOnAnyScope}. */
  async assertCanOperateOnAnyScope(
    ctx: RBACContext,
    scopes: Scope[],
    permission: AuthzPermission,
  ): Promise<void> {
    if (!ctx.session) {
      throw permissionDenied(permission, scopes[0]);
    }

    return this.assertActorCanOperateOnAnyScope(
      { actor: { kind: "session", session: ctx.session }, permissions: ctx.permissions },
      scopes,
      permission,
    );
  }

  async loadMembershipSet(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipSet> {
    const [organizationRole, memberTeamIds] = await Promise.all([
      this.enabledRole(input),
      this.organizations.findMemberTeamIds(input),
    ]);
    const teamIds = new Set(memberTeamIds);
    const projectIds =
      teamIds.size > 0
        ? await this.directory.findProjectIdsForTeams({ teamIds: [...teamIds] })
        : [];

    return {
      isOrgMember: organizationRole !== null && seatSharesOrganizationKeys(organizationRole.role),
      isOrgAdmin: organizationRole?.role === "ADMIN",
      teamIds,
      projectIds: new Set(projectIds),
    };
  }

  /**
   * What a credential acting in one project reads keys as: organization-wide keys, its team's and
   * its own, never a sibling team's. An unknown project reaches organization-wide keys only.
   */
  async membershipOfProject(projectId: string): Promise<MembershipSet> {
    const project = await this.projects.findIdentity(projectId);

    return {
      isOrgMember: true,
      isOrgAdmin: false,
      teamIds: new Set(project ? [project.teamId] : []),
      projectIds: new Set([projectId]),
    };
  }

  /**
   * Keys an actor holds `permission` on at one of their scopes or more. Read visibility for a key
   * that names no project: its grants decide, and each distinct scope is asked once.
   */
  async heldByActor<Key extends { scopes: Scope[] }>(
    ctx: ActorContext,
    keys: readonly Key[],
    permission: AuthzPermission,
  ): Promise<Key[]> {
    const answers = new Map<string, Promise<boolean>>();
    const holds = (scope: Scope): Promise<boolean> => {
      const address = `${scope.scopeType}:${scope.scopeId}`;
      const known = answers.get(address);
      if (known) return known;
      const asked = this.actorHasPermissionAtScope(ctx, scope, permission);
      answers.set(address, asked);

      return asked;
    };
    const held = await Promise.all(
      keys.map(async (key) => (await Promise.all(key.scopes.map(holds))).some(Boolean)),
    );

    return keys.filter((_key, index) => held[index]);
  }

  /**
   * Every requested scope must belong to the key's own organization. Proving the caller controls
   * each scope is not the same as proving it lives in this organization: without this, a caller
   * with rights in one org could submit another's id plus a scope from theirs.
   */
  async assertScopesBelongToOrg({
    organizationId,
    scopes,
  }: {
    organizationId: string;
    scopes: { scopeType: string; scopeId: string }[];
  }): Promise<void> {
    const idsOfType = (scopeType: string) =>
      scopes.filter((s) => s.scopeType === scopeType).map((s) => s.scopeId);

    if (scopes.some((s) => s.scopeType === "ORGANIZATION" && s.scopeId !== organizationId)) {
      throw new GatewayScopeOrgMismatchError("organization");
    }

    await assertAllResolve("team", idsOfType("TEAM"), (teamIds) =>
      this.directory.findTeamIdsInOrganization({ organizationId, teamIds }),
    );

    await assertAllResolve("project", idsOfType("PROJECT"), (projectIds) =>
      this.projectIdsInOrganization({ organizationId, projectIds }),
    );
  }

  /**
   * The one project a key's guardrails are judged against: its single project scope, else its
   * trace destination. With neither there is no guardrail surface, so it throws
   * GatewayGuardrailProjectMismatchError.
   */
  async getGuardrailProjectId({
    organizationId,
    vkId,
    inputScopes,
    traceProjectId,
  }: GuardrailProjectKey): Promise<string> {
    let scopes = inputScopes;
    let storedTraceProjectId: string | null = null;
    if (!scopes && vkId) {
      const vk = await this.directory.findVirtualKeyScopes({
        virtualKeyId: vkId,
        organizationId,
      });
      scopes = vk?.scopes;
      storedTraceProjectId = vk?.traceProjectId ?? null;
    }

    const projectScopes = (scopes ?? []).filter((s) => s.scopeType === "PROJECT");
    if (projectScopes.length === 1) {
      return projectScopes[0]!.scopeId;
    }

    // Guardrails are project-scoped and enforce where traces land, so an
    // org- or team-owned key's guardrail surface is its explicit trace
    // destination.
    const destination = traceProjectId ?? storedTraceProjectId;
    if (!destination) {
      throw new GatewayGuardrailProjectMismatchError();
    }

    return destination;
  }

  /**
   * The explicit trace destination must be a project of the key's own
   * organization: it decides where traces (and therefore budget debits)
   * land, and a stray id would route another tenant's costs.
   */
  async assertTraceProjectBelongsToOrg({
    organizationId,
    traceProjectId,
  }: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    if (!traceProjectId) {
      return;
    }

    const found = await this.projectIdsInOrganization({
      organizationId,
      projectIds: [traceProjectId],
    });
    if (found.length === 0) {
      throw new GatewayScopeOrgMismatchError("project");
    }
  }

  /**
   * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
   * Validates guardrail attachments before handoff: every referenced guardrail must belong to the
   * key's own project, and the actor must hold the attach permission on it.
   */
  async assertGuardrailAttachmentsAllowed(
    ctx: ActorContext,
    key: GuardrailProjectKey,
    attachments: GuardrailAttachment[] | undefined,
  ): Promise<void> {
    const referencedIds = Array.from(new Set((attachments ?? []).flatMap((a) => a.guardrailIds)));
    if (referencedIds.length === 0) {
      return;
    }

    const vkProjectId = await this.getGuardrailProjectId(key);

    // Any referenced guardrail that belongs to a different project (or does
    // not exist) is simply absent from the result, so the membership check
    // below rejects it.
    const foundIds = new Set(
      await this.directory.findGuardrailIdsInProject({
        projectId: vkProjectId,
        guardrailIds: referencedIds,
      }),
    );

    if (referencedIds.some((id) => !foundIds.has(id))) {
      throw new GatewayGuardrailProjectMismatchError();
    }

    const allowed = await this.actorHasPermissionAtScope(
      ctx,
      { scopeType: "PROJECT", scopeId: vkProjectId },
      "gatewayGuardrails:attach",
    );
    if (!allowed) {
      throw new GuardrailAttachForbiddenError();
    }
  }

  isVisibleToMembership(membership: MembershipSet, scopes: Scope[]): boolean {
    // Org admins manage the whole org, so list/get visibility mirrors the
    // permission cascade — list/get only ever pass VKs already scoped to the
    // caller's org, so a blanket true here can't leak another org's keys.
    // Without it, the auto-provisioned per-project Langy VK is invisible to
    // the very admin who owns it (real admins hold no per-team TeamUser rows).
    if (membership.isOrgAdmin) {
      return true;
    }

    return scopes.some((scope) => {
      if (scope.scopeType === "ORGANIZATION") {
        return membership.isOrgMember;
      }

      if (scope.scopeType === "TEAM") {
        return membership.teamIds.has(scope.scopeId);
      }

      return membership.projectIds.has(scope.scopeId);
    });
  }

  /**
   * Precondition every by-id mutation shares: the key must exist. Authorization is a separate,
   * permission-based decision on the returned key's scopes, so this deliberately does not filter
   * by visibility — a scope role-binding holder can operate on a key membership never surfaces.
   */
  async getExistingVk(
    reader: VirtualKeyReader,
    id: string,
    organizationId: string,
  ): Promise<VirtualKeyWithScopes> {
    const vk = await reader.findById(id, organizationId);
    if (!vk) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }

  /**
   * Precondition every by-id read shares: the key must exist and fall inside the caller's
   * membership set. Both answer not-found, since a distinguishable forbidden would be an existence
   * oracle. The membership set is derived per door, but the check itself is shared.
   */
  async getVisibleVk(
    reader: VirtualKeyReader,
    membership: MembershipSet,
    { id, organizationId }: { id: string; organizationId: string },
  ): Promise<VirtualKeyWithScopes> {
    const vk = await this.getExistingVk(reader, id, organizationId);
    if (!this.isVisibleToMembership(membership, vk.scopes)) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }
}
