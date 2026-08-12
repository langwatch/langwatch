/**
 * ADR-092 §5 — the tRPC adapter. `protectedProcedure.permission("…")` sugar
 * compiles down to this middleware: a DECLARED scope read off the validated
 * input, one engine decision through the composed AuthzService,
 * legacy-compatible error shapes.
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
import { LiteMemberRestrictedError } from "../app-layer/permissions/errors";
import type { Session } from "../auth";
import { authz, authzCollector } from "./runtime";

const logger = createLogger("langwatch:authz");

type ScopeInput = {
  projectId?: string;
  teamId?: string;
  organizationId?: string;
};

/** Which validated-input id carries the scope of a permission gate. */
export type PermissionGateScope = "project" | "team" | "organization";

export type PermissionGateOptions = {
  scope: PermissionGateScope;
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
 * Engine-backed permission middleware. The procedure DECLARES which input
 * id carries its scope — there is no fallback chain, so a gate can never
 * silently check a wider scope than the one it was written against, and a
 * declared id missing from the input is a wiring bug that fails loudly.
 */
export const checkPermissionV2 =
  (permission: AuthzPermission, options: PermissionGateOptions) =>
  async ({ ctx, input, next }: MiddlewareParams) => {
    // `publicProcedure` exposes `.permission()` too, so a session is not a
    // given here. Answering "unauthenticated" before any id is looked at
    // keeps an anonymous caller from learning anything about the scope.
    const user = ctx.session?.user;
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const scope = await requireScopeFromInput({
      input,
      permission,
      level: options.scope,
    });

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
 * Resolve the gate's scope from the procedure input, reading exactly the
 * declared id. A missing id is a wiring bug and fails loudly before any
 * grants are read; an id that does not resolve is denied.
 */
async function requireScopeFromInput({
  input,
  permission,
  level,
}: {
  input: ScopeInput;
  permission: AuthzPermission;
  level: PermissionGateScope;
}): Promise<AuthzScopeRef> {
  const id = input[`${level}Id`];
  if (!id) {
    // Nothing the caller did can fix this, so the sentence they read says
    // only that; which procedure is miswired goes to the log.
    logger.error(
      { permission, declaredScope: level },
      "permission gate declares a scope its procedure input does not carry",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong. Please try again.",
    });
  }

  const scope = await authzCollector.resolveScopeRef(
    level === "project"
      ? { projectId: id }
      : level === "team"
        ? { teamId: id }
        : { organizationId: id },
  );
  if (scope) return scope;

  // An id that resolves to nothing answers exactly like an id the caller may
  // not touch. Two things used to leak here: the 401-with-prose told an
  // outsider whether an id EXISTS, and the missing error code left the
  // client rendering a generic "unknown error" for a denial it can name.
  throw deniedError({
    permission,
    scope: { type: level, id },
    denialReason: "no-membership",
  });
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
