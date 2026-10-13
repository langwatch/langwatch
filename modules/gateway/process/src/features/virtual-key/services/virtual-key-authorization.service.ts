import { type AuthzPermission, PermissionDeniedError } from "@langwatch/authorization";
import type { VirtualKeyWithScopes, GuardrailAttachment } from "@langwatch/gateway-contract";
import {
  GatewayGuardrailProjectMismatchError,
  GuardrailAttachForbiddenError,
} from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { VirtualKeyAuthorizationRepository } from "../../../repositories/virtual-key-authorization.repository.ts";
import { VirtualKeyMembershipService } from "./virtual-key-membership.service.ts";
import {
  VirtualKeyOrgOwnershipService,
  type GuardrailProjectKey,
} from "./virtual-key-org-ownership.service.ts";
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
    denialReason: "no-grant",
  });
}

/**
 * Scopes a user reaches by membership within one org. List and read visibility is membership-based
 * rather than permission-based: a key is visible when one of its scopes intersects this set, so a
 * plain org member sees org-scoped keys and a team member sees that team's but not a sibling's.
 */
export type MembershipSet = {
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
    projects: Pick<ProjectApi, "findIdentity" | "listIdsByOrganization" | "findTraceDestination">;
  }): VirtualKeyAuthorizationService {
    return new VirtualKeyAuthorizationService(input.directory, input.organizations, input.projects);
  }

  private readonly membership: VirtualKeyMembershipService;
  private readonly ownership: VirtualKeyOrgOwnershipService;

  private constructor(
    private readonly directory: VirtualKeyAuthorizationRepository,
    organizations: Pick<OrganizationApi, "getMember" | "findMemberTeamIds">,
    private readonly projects: Pick<
      ProjectApi,
      "findIdentity" | "listIdsByOrganization" | "findTraceDestination"
    >,
  ) {
    this.membership = VirtualKeyMembershipService.create({ directory, organizations, projects });
    this.ownership = VirtualKeyOrgOwnershipService.create({ directory, projects });
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

  loadMembershipSet(input: { organizationId: string; userId: string }): Promise<MembershipSet> {
    return this.membership.loadMembershipSet(input);
  }

  /** Organization-wide keys, the project's team's and its own; see the membership service. */
  membershipOfProject(projectId: string): Promise<MembershipSet> {
    return this.membership.membershipOfProject(projectId);
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

  /** Every requested scope must belong to the key's own organization. */
  assertScopesBelongToOrg(input: {
    organizationId: string;
    scopes: { scopeType: string; scopeId: string }[];
  }): Promise<void> {
    return this.ownership.assertScopesBelongToOrg(input);
  }

  /** The one project a key's guardrails are judged against. */
  getGuardrailProjectId(key: GuardrailProjectKey): Promise<string> {
    return this.ownership.getGuardrailProjectId(key);
  }

  /** The explicit trace destination must be a project of the key's own organization. */
  assertTraceProjectBelongsToOrg(input: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    return this.ownership.assertTraceProjectBelongsToOrg(input);
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
    return this.membership.isVisibleToMembership(membership, scopes);
  }

  /** The key must exist; authorization on its scopes is a separate decision. */
  getExistingVk(
    reader: VirtualKeyReader,
    id: string,
    organizationId: string,
  ): Promise<VirtualKeyWithScopes> {
    return this.membership.getExistingVk(reader, id, organizationId);
  }

  /** The key must exist and fall inside the caller's membership set; both answer not-found. */
  getVisibleVk(
    reader: VirtualKeyReader,
    membership: MembershipSet,
    key: { id: string; organizationId: string },
  ): Promise<VirtualKeyWithScopes> {
    return this.membership.getVisibleVk(reader, membership, key);
  }
}

/** The scope a virtual key is reachable from, as the key's own rows spell it. */
export type GatewayPermissionScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

/**
 * The one authorization seam the virtual-key write paths decide on. Two
 * questions, not one, because a scoped API key resolves through its own
 * ceiling (`effective = key ∩ user`) rather than the session's full cascade.
 */
export interface GatewayScopePermissions {
  sessionHolds(input: {
    userId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;

  apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;
}
