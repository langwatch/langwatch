import { TRPCError } from "@trpc/server";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GuardrailAttachForbiddenError,
  VirtualKeyNotFoundError,
} from "@langwatch/gateway-contract";
import type { GatewayScopePermissionsPort } from "../ports/gateway-scope-permissions.port";
import type { GuardrailAttachment } from "@langwatch/gateway-contract";
import type { VirtualKeyAuthorizationRepository } from "../repositories/virtual-key-authorization.repository";
import type { VirtualKeyService } from "./virtual-key.service";

/**
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 * Scope-aware authorization for VirtualKey write paths, replacing the org-wide virtualKeys:manage gate (too coarse: let team admins mint org keys, required org grants for single-team management) with per-scope checks. CREATE authorizes against the REQUESTED scopes (manage on EVERY one, fail-closed intersection); UPDATE/ROTATE/DELETE authorize against the EXISTING scopes (op permission on AT LEAST ONE). Upward cascade lives in probeTeamPermission/probeProjectPermission. No new code relies on the legacy TeamUserRole.ADMIN short-circuit (@no-short-circuit invariant), so its eventual removal needs no sweep here. Identity is (user, permission, scope), not the deployment's session object, to avoid coupling this package to one auth library's shape.
 */
export type VirtualKeySessionActor = { user: { id: string } } | null;

export type RBACContext = {
  session: VirtualKeySessionActor;
  permissions: GatewayScopePermissionsPort;
};

export type Scope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Identity a VK write is authorized as — one vocabulary for both doors, so REST and tRPC can't diverge: session (browser, role-binding cascade), apiKey (scoped API key, checked via effective = key ∩ user at each touched scope), legacyProjectKey (full access to PROJECT:<their project> only, denied elsewhere).
 */
export type VirtualKeyActor =
  | { kind: "session"; session: VirtualKeySessionActor }
  | {
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
    }
  | { kind: "legacyProjectKey"; projectId: string };

export type ActorContext = {
  actor: VirtualKeyActor;
  /** The one authorization seam. See {@link GatewayScopePermissionsPort}. */
  permissions: GatewayScopePermissionsPort;
};

function scopeLabel(scope: Scope): string {
  return `${scope.scopeType}:${scope.scopeId}`;
}

/**
 * Scopes a user reaches by MEMBERSHIP within one org: isOrgMember, teamIds (their teams), projectIds (those teams' projects). List/read visibility is membership-based, not permission-based — a VK is visible when one of its scopes intersects this set, so a plain org member with no virtualKeys:view still sees org-scoped keys, and a team member sees that team's keys but not a sibling's.
 */
export type MembershipSet = {
  isOrgMember: boolean;
  /**
   * Caller is an ORG-level admin: VK visibility short-circuits to "sees everything in the org", since real org owners hold no per-team TeamUser rows and would otherwise be blind to the per-project auto-provisioned Langy VK they own.
   */
  isOrgAdmin: boolean;
  teamIds: Set<string>;
  projectIds: Set<string>;
};

/**
 * Every id must come back from an org-scoped lookup — an id naming another tenant's row simply doesn't match the where clause, so absence from the result IS the refusal, and the query never has to compare tenants itself.
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
export type VirtualKeyReader = Pick<VirtualKeyService, "getById">;

/**
 * Scope-aware authorization for the virtual-key write paths. Every call names
 * the context it authorizes against, so both doors into the service layer
 * enforce one vocabulary.
 */
export class VirtualKeyAuthorizationService {
  static create(input: {
    directory: VirtualKeyAuthorizationRepository;
  }): VirtualKeyAuthorizationService {
    return new VirtualKeyAuthorizationService(input.directory);
  }

  private constructor(private readonly directory: VirtualKeyAuthorizationRepository) {}

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

    const project = await this.directory.tryFindProjectTeam({ projectId: scope.scopeId });
    // Fail closed on a dangling project reference.
    if (!project) {
      return null;
    }

    return { type: "project", id: project.id, teamId: project.teamId };
  }

  /**
   * Create gate: require `virtualKeys:manage` on every requested scope.
   * Throws FORBIDDEN naming the first unauthorized scope so the caller sees
   * exactly which grant is missing.
   */
  async assertActorCanManageAllScopes(ctx: ActorContext, scopes: Scope[]): Promise<void> {
    // Deny on an empty list rather than falling through the loop: "the caller
    // controls every scope in {}" is vacuously true, which would make this gate
    // the one permission check in the file that grants by default. Its sibling
    // `assertActorCanOperateOnAnyScope` already denies an empty list, and two
    // gates in one file with opposite empty-input answers is the trap.
    if (scopes.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "permission_denied" });
    }

    if (ctx.actor.kind === "session" && !ctx.actor.session) {
      throw new TRPCError({ code: "FORBIDDEN", message: "permission_denied" });
    }

    for (const scope of scopes) {
      if (!(await this.actorHasPermissionAtScope(ctx, scope, "virtualKeys:manage"))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `permission_denied: virtualKeys:manage at ${scopeLabel(scope)}`,
        });
      }
    }
  }

  /**
   * Update / rotate / delete gate: require the op permission on at least one
   * of the key's existing scopes. Throws FORBIDDEN when the caller holds it
   * on none of them.
   */
  async assertActorCanOperateOnAnyScope(
    ctx: ActorContext,
    scopes: Scope[],
    permission: AuthzPermission,
  ): Promise<void> {
    for (const scope of scopes) {
      if (await this.actorHasPermissionAtScope(ctx, scope, permission)) {
        return;
      }
    }

    throw new TRPCError({
      code: "FORBIDDEN",
      message: `permission_denied: ${permission} at one of the virtual key's scopes`,
    });
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
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `permission_denied: ${permission} at one of the virtual key's scopes`,
      });
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
      this.directory.tryFindOrganizationRole(input),
      this.directory.findMemberTeamIds(input),
    ]);
    const teamIds = new Set(memberTeamIds);
    const projectIds =
      teamIds.size > 0
        ? await this.directory.findProjectIdsForTeams({ teamIds: [...teamIds] })
        : [];

    return {
      isOrgMember: organizationRole !== null,
      isOrgAdmin: organizationRole?.role === OrganizationUserRole.ADMIN,
      teamIds,
      projectIds: new Set(projectIds),
    };
  }

  /**
   * Every requested scope must belong to the VK's own organization. assertActorCanManageAllScopes only proves the caller controls each scope, not that it lives in organizationId — without this, a caller with org-A manage rights could submit organizationId=B plus a scope from A and write a cross-org VK row.
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
      this.directory.findProjectIdsInOrganization({ organizationId, projectIds }),
    );
  }

  /**
   * Resolve the single PROJECT scope a VK is reachable from — guardrails are project-scoped, so a VK can only attach guardrails from this one (trace) project. Returns null for zero or multiple PROJECT scopes, neither having a well-defined guardrail surface.
   */
  async resolveVkProjectId({
    organizationId,
    vkId,
    inputScopes,
    traceProjectId,
  }: {
    organizationId: string;
    vkId: string | null;
    inputScopes: { scopeType: string; scopeId: string }[] | undefined;
    traceProjectId?: string | null;
  }): Promise<string | null> {
    let scopes = inputScopes;
    let storedTraceProjectId: string | null = null;
    if (!scopes && vkId) {
      const vk = await this.directory.tryFindVirtualKeyScopes({
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
    return traceProjectId ?? storedTraceProjectId;
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

    const found = await this.directory.findProjectIdsInOrganization({
      organizationId,
      projectIds: [traceProjectId],
    });
    if (found.length === 0) {
      throw new GatewayScopeOrgMismatchError("project");
    }
  }

  /**
   * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature (@cross-project + @rbac)
   * Validates guardrail attachments before handoff: every referenced guardrail must belong to the VK's own project (else BAD_REQUEST guardrail_project_mismatch), and the actor must hold gatewayGuardrails:attach on it (else FORBIDDEN).
   */
  async assertGuardrailAttachmentsAllowed(
    ctx: ActorContext,
    vkProjectId: string | null,
    attachments: GuardrailAttachment[] | undefined,
  ): Promise<void> {
    const referencedIds = Array.from(new Set((attachments ?? []).flatMap((a) => a.guardrailIds)));
    if (referencedIds.length === 0) {
      return;
    }

    if (!vkProjectId) {
      throw new GatewayGuardrailProjectMismatchError();
    }

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
   * Precondition every by-id MUTATION shares: the key must exist. Authorization is a separate, permission-based decision on the returned key's scopes, so this deliberately doesn't filter by visibility — a scope role-binding holder can operate on a key its membership set never surfaces.
   */
  async requireExistingVk(reader: VirtualKeyReader, id: string, organizationId: string) {
    const vk = await reader.getById(id, organizationId);
    if (!vk) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }

  /**
   * Precondition every by-id READ shares: the key must exist AND fall inside the caller's membership set. Both answer virtual_key_not_found — a distinguishable forbidden would be an existence oracle for keys in teams the caller has no part in. Membership set is derived per door (session loads it from the user's rows; a project credential synthesizes the one its project implies) but the check itself is shared, so doors can't drift on what "visible" means.
   */
  async requireVisibleVk(
    reader: VirtualKeyReader,
    membership: MembershipSet,
    { id, organizationId }: { id: string; organizationId: string },
  ) {
    const vk = await this.requireExistingVk(reader, id, organizationId);
    if (!this.isVisibleToMembership(membership, vk.scopes)) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }
}
