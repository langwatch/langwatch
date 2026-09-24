import type { AuthzPermission as Permission } from "@langwatch/authz";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~/generated/prisma/client";
import { authzChecksFor } from "~/server/app-layer/authz/checks";
import {
  probeOrganizationPermission,
  probeProjectPermission,
  probeTeamPermission,
} from "~/server/app-layer/permissions/imperative";
import type { Session } from "~/server/auth";
import { resolveApiKeyPermission } from "../app-layer/authz/credential-permissions";
import {
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GuardrailAttachForbiddenError,
  VirtualKeyNotFoundError,
} from "./errors";
import type { GuardrailAttachment } from "./virtualKey.config";
import type { VirtualKeyService } from "./virtualKey.service";

/**
 * Creation requires virtualKeys:manage on every requested scope. Updates,
 * rotation and deletion require the operation on at least one existing scope.
 * The authz engine handles organization and team grant inheritance.
 */
export type RBACContext = { prisma: PrismaClient; session: Session | null };

export type Scope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * The identity a VK write is authorized as. One vocabulary for both doors
 * into the service layer, so REST and tRPC cannot enforce different rules:
 *
 *   - `session`          — a browser session (tRPC). Checked through the
 *                          current grants for that user.
 *   - `apiKey`           — a scoped API key (public REST). Checked through
 *                          the API-key ceiling (`effective = key ∩ user`)
 *                          at each scope the call touches.
 *   - `legacyProjectKey` — a legacy project API key (public REST). These
 *                          historically carry full access to their own
 *                          project and nothing beyond it, so they are
 *                          authorized at exactly the scope
 *                          `PROJECT:<their project>` and denied elsewhere.
 */
export type VirtualKeyActor =
  | { kind: "session"; session: Session | null }
  | {
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
    }
  | { kind: "legacyProjectKey"; projectId: string };

export type ActorContext = { prisma: PrismaClient; actor: VirtualKeyActor };

function scopeLabel(scope: Scope): string {
  return `${scope.scopeType}:${scope.scopeId}`;
}

async function actorHasPermissionAtScope(
  ctx: ActorContext,
  scope: Scope,
  permission: Permission,
): Promise<boolean> {
  const { prisma, actor } = ctx;
  switch (actor.kind) {
    case "session": {
      if (!actor.session) return false;
      const sessionCtx = { prisma, session: actor.session };
      if (scope.scopeType === "ORGANIZATION") {
        return probeOrganizationPermission(
          sessionCtx,
          scope.scopeId,
          permission,
        );
      }
      if (scope.scopeType === "TEAM") {
        return probeTeamPermission(sessionCtx, scope.scopeId, permission);
      }
      return probeProjectPermission(sessionCtx, scope.scopeId, permission);
    }
    case "apiKey": {
      const scopeRef = await scopeRefFor(prisma, scope);
      if (!scopeRef) return false;
      return resolveApiKeyPermission({
        prisma,
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
async function scopeRefFor(
  prisma: PrismaClient,
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
  const project = await prisma.project.findUnique({
    where: { id: scope.scopeId },
    select: { id: true, teamId: true },
  });
  // Fail closed on a dangling project reference.
  if (!project) return null;
  return { type: "project", id: project.id, teamId: project.teamId };
}

/**
 * Create gate: require `virtualKeys:manage` on every requested scope.
 * Throws FORBIDDEN naming the first unauthorized scope so the caller sees
 * exactly which grant is missing.
 */
export async function assertActorCanManageAllScopes(
  ctx: ActorContext,
  scopes: Scope[],
): Promise<void> {
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
    if (!(await actorHasPermissionAtScope(ctx, scope, "virtualKeys:manage"))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `permission_denied: virtualKeys:manage at ${scopeLabel(scope)}`,
      });
    }
  }
}

/**
 * Create gate for a caller that speaks for one project (the public REST
 * door). A key scoped to nothing but the caller's own project needs
 * `virtualKeys:create` there and nothing more: issuing a project's own keys
 * is the day job of anyone driving the gateway from it, and the Langy session
 * key holds `create` while `manage` is withheld from it on purpose, since
 * `manage` implies `rotate` (see `langyPermissionPolicy.ts`). Every other
 * shape, an organization or team scope, another project, or several scopes
 * at once, still needs `virtualKeys:manage` on every scope requested, the
 * same fail-closed intersection as {@link assertActorCanManageAllScopes}.
 */
export async function assertActorCanCreateScopes(
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
    return assertActorCanManageAllScopes(ctx, scopes);
  }
  if (ctx.actor.kind === "session" && !ctx.actor.session) {
    throw new TRPCError({ code: "FORBIDDEN", message: "permission_denied" });
  }
  if (!(await actorHasPermissionAtScope(ctx, only, "virtualKeys:create"))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `permission_denied: virtualKeys:create at ${scopeLabel(only)}`,
    });
  }
}

/**
 * Update / rotate / delete gate: require the op permission on at least one
 * of the key's existing scopes. Throws FORBIDDEN when the caller holds it
 * on none of them.
 */
export async function assertActorCanOperateOnAnyScope(
  ctx: ActorContext,
  scopes: Scope[],
  permission: Permission,
): Promise<void> {
  for (const scope of scopes) {
    if (await actorHasPermissionAtScope(ctx, scope, permission)) return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `permission_denied: ${permission} at one of the virtual key's scopes`,
  });
}

/** Session-shaped wrapper over {@link assertActorCanManageAllScopes}. */
export async function assertCanManageAllScopes(
  ctx: RBACContext,
  scopes: Scope[],
): Promise<void> {
  return assertActorCanManageAllScopes(
    { prisma: ctx.prisma, actor: { kind: "session", session: ctx.session } },
    scopes,
  );
}

/** Session-shaped wrapper over {@link assertActorCanOperateOnAnyScope}. */
export async function assertCanOperateOnAnyScope(
  ctx: RBACContext,
  scopes: Scope[],
  permission: Permission,
): Promise<void> {
  if (!ctx.session) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `permission_denied: ${permission} at one of the virtual key's scopes`,
    });
  }
  return assertActorCanOperateOnAnyScope(
    { prisma: ctx.prisma, actor: { kind: "session", session: ctx.session } },
    scopes,
    permission,
  );
}

/**
 * The set of scopes a user can reach by *membership* within one org:
 *   - `isOrgMember`  — has an OrganizationUser row for the org.
 *   - `teamIds`      — teams in the org the user belongs to (TeamUser).
 *   - `projectIds`   — projects living in any of those teams.
 *
 * List/read visibility is membership-based, not permission-based: a VK is
 * visible when one of its scopes intersects this set (vk-scope-rbac.feature
 * "A user sees VKs whose scopes intersect their membership set"). A plain
 * org member with no `virtualKeys:view` grant still sees org-scoped keys,
 * and a team member sees that team's keys — but not a sibling team's.
 */
export type MembershipSet = {
  isOrgMember: boolean;
  canViewAllScopes: boolean;
  teamIds: Set<string>;
  projectIds: Set<string>;
};

export async function loadMembershipSet(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<MembershipSet> {
  const member = await prisma.organizationUser.findFirst({
    where: { userId, organizationId, disabledAt: null },
    select: { userId: true },
  });
  const empty: MembershipSet = {
    isOrgMember: member !== null,
    canViewAllScopes: false,
    teamIds: new Set(),
    projectIds: new Set(),
  };
  if (!member) return empty;

  const authz = authzChecksFor(prisma);
  const principal = { type: "user", id: userId } as const;
  const organizationAccess = await authz.checkByIds({
    principal,
    organizationId,
    permission: "virtualKeys:view",
  });
  if (organizationAccess.allowed) return { ...empty, canViewAllScopes: true };

  const [teams, projects] = await Promise.all([
    prisma.team.findMany({ where: { organizationId }, select: { id: true } }),
    prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, teamId: true },
    }),
  ]);
  const decisions = await authz.canBatchByIds({
    principal,
    organizationId,
    permission: "virtualKeys:view",
    teams: teams.map(({ id }) => ({ teamId: id })),
    projects: projects.map(({ id, teamId }) => ({ projectId: id, teamId })),
  });
  return {
    ...empty,
    teamIds: new Set(
      teams.filter(({ id }) => decisions.teams.get(id)).map(({ id }) => id),
    ),
    projectIds: new Set(
      projects
        .filter(({ id }) => decisions.projects.get(id))
        .map(({ id }) => id),
    ),
  };
}

/**
 * Every requested scope must belong to the VK's own organization.
 * `assertActorCanManageAllScopes` only proves the caller controls each
 * scope, not that the scope lives in `organizationId` — without this, a
 * caller with manage rights in org A could submit `organizationId` for
 * org B plus a scope from org A and write a cross-org VK row.
 * ORGANIZATION scopes must equal the org; TEAM/PROJECT scopes must
 * resolve to it.
 */
export async function assertScopesBelongToOrg(
  prisma: PrismaClient,
  organizationId: string,
  scopes: { scopeType: string; scopeId: string }[],
): Promise<void> {
  const idsOfType = (scopeType: string) =>
    scopes.filter((s) => s.scopeType === scopeType).map((s) => s.scopeId);

  if (
    scopes.some(
      (s) => s.scopeType === "ORGANIZATION" && s.scopeId !== organizationId,
    )
  ) {
    throw new GatewayScopeOrgMismatchError("organization");
  }

  await assertAllResolve("team", idsOfType("TEAM"), (ids) =>
    prisma.team.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true },
    }),
  );

  await assertAllResolve("project", idsOfType("PROJECT"), (ids) =>
    prisma.project.findMany({
      where: { id: { in: ids }, team: { organizationId } },
      select: { id: true },
    }),
  );
}

/**
 * Every id must come back from an org-scoped lookup. An id that names
 * another tenant's row simply does not match the `where`, so absence from
 * the result is the refusal: the query never has to compare tenants
 * itself.
 */
async function assertAllResolve(
  scopeType: string,
  ids: string[],
  lookup: (ids: string[]) => Promise<{ id: string }[]>,
): Promise<void> {
  if (ids.length === 0) return;
  const found = new Set((await lookup(ids)).map((row) => row.id));
  if (ids.some((id) => !found.has(id))) {
    throw new GatewayScopeOrgMismatchError(scopeType);
  }
}

/**
 * Resolve the single PROJECT scope a VK is reachable from. Guardrails are
 * project-scoped, so a VK can only attach guardrails from this one
 * project (its trace project). Returns null when the VK has zero or more
 * than one PROJECT scope — neither has a well-defined guardrail surface.
 */
export async function resolveVkProjectId(
  prisma: PrismaClient,
  organizationId: string,
  {
    vkId,
    inputScopes,
    traceProjectId,
  }: {
    vkId: string | null;
    inputScopes: { scopeType: string; scopeId: string }[] | undefined;
    traceProjectId?: string | null;
  },
): Promise<string | null> {
  let scopes = inputScopes;
  let storedTraceProjectId: string | null = null;
  if (!scopes && vkId) {
    const vk = await prisma.virtualKey.findFirst({
      where: { id: vkId, organizationId },
      select: {
        traceProjectId: true,
        scopes: { select: { scopeType: true, scopeId: true } },
      },
    });
    scopes = vk?.scopes;
    storedTraceProjectId = vk?.traceProjectId ?? null;
  }
  const projectScopes = (scopes ?? []).filter((s) => s.scopeType === "PROJECT");
  if (projectScopes.length === 1) return projectScopes[0]!.scopeId;
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
export async function assertTraceProjectBelongsToOrg(
  prisma: PrismaClient,
  organizationId: string,
  traceProjectId: string | null | undefined,
): Promise<void> {
  if (!traceProjectId) return;
  const project = await prisma.project.findFirst({
    where: { id: traceProjectId, team: { organizationId } },
    select: { id: true },
  });
  if (!project) {
    throw new GatewayScopeOrgMismatchError("project");
  }
}

/**
 * Validate guardrail attachments before handing off to the service:
 *   - every referenced guardrail must belong to the VK's own project
 *     (guardrails are project-scoped; the materialiser only ships the
 *     VK trace-project's guardrails) — else BAD_REQUEST
 *     `guardrail_project_mismatch`.
 *   - the actor must hold `gatewayGuardrails:attach` on that project —
 *     else FORBIDDEN `missing_perm:gatewayGuardrails:attach`.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 *       — @cross-project + @rbac scenarios.
 */
export async function assertGuardrailAttachmentsAllowed(
  ctx: ActorContext,
  vkProjectId: string | null,
  attachments: GuardrailAttachment[] | undefined,
): Promise<void> {
  const referencedIds = Array.from(
    new Set((attachments ?? []).flatMap((a) => a.guardrailIds)),
  );
  if (referencedIds.length === 0) return;

  if (!vkProjectId) {
    throw new GatewayGuardrailProjectMismatchError();
  }

  // Scope the lookup to the VK's own project. Any referenced guardrail
  // that belongs to a different project (or doesn't exist) is simply
  // absent from the result, so the membership check below rejects it.
  // Scoping by projectId also satisfies the multitenancy middleware.
  const rows = await ctx.prisma.gatewayGuardrail.findMany({
    where: { id: { in: referencedIds }, projectId: vkProjectId },
    select: { id: true },
  });
  const foundIds = new Set(rows.map((r) => r.id));

  if (referencedIds.some((id) => !foundIds.has(id))) {
    throw new GatewayGuardrailProjectMismatchError();
  }

  const allowed = await actorHasPermissionAtScope(
    ctx,
    { scopeType: "PROJECT", scopeId: vkProjectId },
    "gatewayGuardrails:attach",
  );
  if (!allowed) {
    throw new GuardrailAttachForbiddenError();
  }
}

export function isVisibleToMembership(
  membership: MembershipSet,
  scopes: Scope[],
): boolean {
  if (membership.canViewAllScopes) return true;
  return scopes.some((scope) => {
    if (scope.scopeType === "ORGANIZATION") return membership.isOrgMember;
    if (scope.scopeType === "TEAM")
      return membership.teamIds.has(scope.scopeId);
    return membership.projectIds.has(scope.scopeId);
  });
}

/** A virtual-key loader. Structurally satisfied by {@link VirtualKeyService}. */
export type VirtualKeyReader = Pick<VirtualKeyService, "getById">;

/**
 * The precondition every by-id MUTATION shares: the key has to exist.
 * Authorization is a separate, permission-based decision the caller makes
 * on the returned key's scopes, so this deliberately does not filter by
 * visibility: a holder of a scope role binding can operate on a key its
 * membership set never surfaces (vk-scope-rbac.feature).
 */
export async function requireExistingVk(
  reader: VirtualKeyReader,
  id: string,
  organizationId: string,
) {
  const vk = await reader.getById(id, organizationId);
  if (!vk) {
    throw new VirtualKeyNotFoundError();
  }
  return vk;
}

/**
 * The precondition every by-id READ shares: the key has to exist AND fall
 * inside the caller's membership set. Both answers are the same
 * `virtual_key_not_found`, because a distinguishable "forbidden" would be
 * an existence oracle for keys in teams the caller has no part in.
 *
 * The membership set is the caller's own, derived per door. A session
 * loads it from its user's rows, a project credential synthesizes the one
 * its project implies. The check itself is shared, so the two doors
 * cannot drift on what "visible" means.
 */
export async function requireVisibleVk(
  reader: VirtualKeyReader,
  membership: MembershipSet,
  { id, organizationId }: { id: string; organizationId: string },
) {
  const vk = await requireExistingVk(reader, id, organizationId);
  if (!isVisibleToMembership(membership, vk.scopes)) {
    throw new VirtualKeyNotFoundError();
  }
  return vk;
}
