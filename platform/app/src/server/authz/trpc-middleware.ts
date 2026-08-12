/**
 * ADR-092 §5 — the tRPC adapter. `protectedProcedure.permission("…")` sugar
 * compiles down to this middleware: input-driven scope extraction, one
 * engine decision through the composed AuthzService, legacy-compatible
 * error shapes.
 *
 * New procedures opt in via `.permission()`; existing `.use(checkXxx…)`
 * sites keep the legacy path (now shadow-compared) until the stage-D
 * codemod.
 */
import {
  type AuthzDecision,
  type AuthzPermission,
  type AuthzScopeRef,
  PermissionDeniedError,
} from "@langwatch/authz";
import { TRPCError } from "@trpc/server";
import { LiteMemberRestrictedError } from "../app-layer/permissions/errors";
import type { Session } from "../auth";
import { authz, authzCollector } from "./runtime";

type ScopeInput = {
  projectId?: string;
  teamId?: string;
  organizationId?: string;
};

type MiddlewareParams = {
  ctx: {
    session: Session;
    permissionChecked: boolean;
    organizationRole?: "ADMIN" | "MEMBER" | "EXTERNAL" | null;
  };
  input: ScopeInput;
  next: () => any;
};

/**
 * Engine-backed permission middleware. Scope precedence mirrors specificity:
 * projectId, then teamId, then organizationId — a procedure whose input
 * carries none of the three is a wiring bug and fails loudly.
 */
export const checkPermissionV2 =
  (permission: AuthzPermission) =>
  async ({ ctx, input, next }: MiddlewareParams) => {
    const scope = await requireScopeFromInput({ input });

    const { decision, grants } = await authz.checkDetailed({
      principal: { type: "user", id: ctx.session.user.id },
      permission,
      scope,
    });

    if (!decision.allowed) {
      throw deniedError({
        permission,
        scope,
        denialReason: decision.denialReason ?? "no-binding",
      });
    }

    ctx.organizationRole = grants.organizationRole;
    ctx.permissionChecked = true;
    return next();
  };

/**
 * Resolve the check's scope from the procedure input, most specific id
 * first. No id at all is a wiring bug and fails loudly; an unknown id
 * denies without leaking (legacy posture).
 */
async function requireScopeFromInput({
  input,
}: {
  input: ScopeInput;
}): Promise<AuthzScopeRef> {
  const scope = await authzCollector.resolveScopeRef({
    projectId: input.projectId,
    teamId: input.projectId ? undefined : input.teamId,
    organizationId:
      input.projectId || input.teamId ? undefined : input.organizationId,
  });
  if (scope) return scope;
  if (!input.projectId && !input.teamId && !input.organizationId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "checkPermissionV2 requires projectId, teamId, or organizationId in the procedure input",
    });
  }
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "You do not have permission to access this resource",
  });
}

function deniedError({
  permission,
  scope,
  denialReason,
}: {
  permission: AuthzPermission;
  scope: AuthzScopeRef;
  denialReason: NonNullable<AuthzDecision["denialReason"]>;
}): TRPCError {
  const denied = new PermissionDeniedError({ permission, scope, denialReason });
  return new TRPCError({
    code: "UNAUTHORIZED",
    message: denied.message,
    // Legacy parity: the lite-member cause drives the client's restriction
    // modal; the HandledError cause carries denialReason for everything else.
    cause:
      denialReason === "lite-member-restricted"
        ? new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown")
        : denied,
  });
}
