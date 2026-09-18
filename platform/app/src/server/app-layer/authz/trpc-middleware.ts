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
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { Session } from "../../auth";
import { LiteMemberRestrictedError } from "../permissions/errors";
import { authz, authzCollector } from "./runtime";

const logger = createLogger("langwatch:authz");

type ScopeInput = {
  projectId?: string;
  teamId?: string;
  organizationId?: string;
};

/** The tier and id a check was refused at - what PermissionDeniedError needs,
 *  which a resolved AuthzScopeRef also satisfies structurally. */
type DeniedScope = { type: AuthzScopeRef["type"]; id: string };

type MiddlewareParams = {
  ctx: {
    session: Session | null;
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
    // `publicProcedure` exposes `.permission()` too, so a session is not a
    // given here. Answering "unauthenticated" before any id is looked at
    // keeps an anonymous caller from learning anything about the scope.
    const user = ctx.session?.user;
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const scope = await requireScopeFromInput({ input, permission });

    const { decision, grants } = await authz.checkDetailed({
      principal: { type: "user", id: user.id },
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
 * first. No id at all is a wiring bug and fails loudly; an id that does not
 * resolve is denied.
 */
async function requireScopeFromInput({
  input,
  permission,
}: {
  input: ScopeInput;
  permission: AuthzPermission;
}): Promise<AuthzScopeRef> {
  const scope = await authzCollector.resolveScopeRef({
    projectId: input.projectId,
    teamId: input.projectId ? undefined : input.teamId,
    organizationId:
      input.projectId || input.teamId ? undefined : input.organizationId,
  });
  if (scope) return scope;

  const requested = requestedScope(input);
  if (!requested) {
    // Nothing the caller did can fix this, so the sentence they read says
    // only that; which procedure is miswired goes to the log.
    logger.error(
      { permission },
      "permission procedure input carries no projectId, teamId, or organizationId",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong. Please try again.",
    });
  }

  // An id that resolves to nothing answers exactly like an id the caller may
  // not touch. Two things used to leak here: the 401-with-prose told an
  // outsider whether an id EXISTS, and the missing error code left the
  // client rendering a generic "unknown error" for a denial it can name.
  throw deniedError({
    permission,
    scope: requested,
    denialReason: "no-membership",
  });
}

/** The tier the caller aimed at, by the same precedence the resolve uses. */
function requestedScope(input: ScopeInput): DeniedScope | null {
  if (input.projectId) return { type: "project", id: input.projectId };
  if (input.teamId) return { type: "team", id: input.teamId };
  if (input.organizationId) {
    return { type: "organization", id: input.organizationId };
  }
  return null;
}

function deniedError({
  permission,
  scope,
  denialReason,
}: {
  permission: AuthzPermission;
  scope: DeniedScope;
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
