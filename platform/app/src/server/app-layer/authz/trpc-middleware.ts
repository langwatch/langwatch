/**
 * ADR-092 §5, delivery-plan decision 25 — the tRPC adapter behind the typed
 * declaration surface. `protectedProcedure.input(…).permission("…")` compiles
 * down to the middleware built here.
 *
 * ONE seam, decision-neutral, properly layered: this middleware is the tRPC
 * boundary, it resolves `getApp().permissions` — the App-composed
 * `PermissionsService`, which takes the
 * `ForkAwarePermissionDecisionRepository`, which owns the client and
 * delegates to the same fork-aware resolvers the legacy
 * `checkXxxPermission` middlewares ran (`rbac.ts`) — so a not-yet-migrated
 * organization is decided by the legacy walk and a migrated one by the engine,
 * chosen by the organization's migration status alone. There is no shadow or
 * reverse-shadow comparison at request time (that path was removed with
 * `shadow.ts`); the fork is a plain if/else on the gate. Deploying the codemod
 * changes no decision anywhere; the contract PR later rewires only the
 * repository — one file, not four hundred call sites.
 *
 * What IS deliberately new here is the denial shape: every tier's refusal now
 * carries the engine's one handled code (`permission_denied`, with the
 * permission and tier in `meta`) where the legacy team/organization
 * middlewares shipped bare prose the client could only render as "unknown
 * error". Lite-member denials keep their dedicated cause — the client modal
 * keys on it.
 *
 * Every middleware built here carries an `AUTHZ_DECLARATION` descriptor, the
 * machine-readable half of the declaration: the sweep test walks the router
 * and refuses any procedure whose chain carries none.
 */
import {
  type AuthzPermission,
  type DeclaredAuthzMiddleware,
  type DeclaredScopeId,
  declareAuthzMiddleware,
  declaredScopeId,
  PermissionDeniedError,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import type { Session } from "../../auth";
import { type App, getApp } from "../app";
import { LiteMemberRestrictedError } from "../permissions/errors";

const logger = createLogger("langwatch:authz");

type ScopeInput = Partial<Record<ScopeTierField, unknown>>;

type MiddlewareParams = {
  ctx: {
    session: Session | null;
    /** The composed App the context factory injected (see `trpc.ts`). */
    app?: App;
    permissionChecked: boolean;
    organizationRole?: OrganizationUserRole | null;
  };
  input: ScopeInput;
  next: () => any;
};

/**
 * The App this request decides through: the one its context factory injected,
 * or the process singleton for contexts built without one (SSG helpers,
 * embedded callers). Both are the same instance in production — the ctx slot
 * exists so a test can hand in a fake without mocking the App module.
 */
const appOf = (ctx: MiddlewareParams["ctx"]): App => ctx.app ?? getApp();

type DeclaredMiddleware = DeclaredAuthzMiddleware<
  (params: MiddlewareParams) => Promise<any>
>;

/**
 * `.permission(p)` / `.permission(p, { via })`. The type layer
 * (`@langwatch/authz-contract` declaration.ts + the builder in `api/trpc.ts`)
 * guarantees the input carries a usable id; the runtime re-derives the same
 * answer and still fails loudly if the two ever disagree.
 */
export const checkDeclaredPermission = ({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "permission", permission, via },
    async ({ ctx, input, next }: MiddlewareParams) => {
      // `publicProcedure` exposes `.permission()` too, so a session is not a
      // given. Answering "unauthenticated" before any id is looked at keeps
      // an anonymous caller from learning anything about the scope.
      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const scope = requireDeclaredScope({ permission, input, via });
      const { permitted, organizationRole } = await appOf(ctx).permissions.getDecision({
        userId: ctx.session.user.id,
        permission,
        scope,
      });
      if (!permitted) {
        throw deniedError({ permission, scope, organizationRole });
      }
      // Legacy parity: the organization tier never carried a role onto the
      // context, so only the project/team resolutions (non-null role) do.
      if (organizationRole !== null) {
        ctx.organizationRole = organizationRole;
      }

      ctx.permissionChecked = true;
      return next();
    },
  );

/**
 * `.permissionAny(…)` — any one of the permissions is enough, checked at the
 * input's project scope. One scope resolution serves every candidate; the
 * denial names the FIRST permission, so callers list the primary surface
 * first (granting it resolves the refusal whichever feature the caller came
 * through).
 */
export const checkDeclaredPermissionAny = (
  permissions: readonly [AuthzPermission, ...AuthzPermission[]],
): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "permission-any", permissions },
    async ({ ctx, input, next }: MiddlewareParams) => {
      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const projectId = input.projectId;
      if (typeof projectId !== "string" || projectId.length === 0) {
        throw wiringBug({ permission: permissions[0] });
      }
      const { permitted, organizationRole } = await appOf(
        ctx,
      ).permissions.getProjectAnyDecision({
        userId: ctx.session.user.id,
        projectId,
        permissions,
      });
      if (!permitted) {
        throw deniedError({
          permission: permissions[0],
          scope: { tier: "project", id: projectId },
          organizationRole,
        });
      }
      ctx.organizationRole = organizationRole;
      ctx.permissionChecked = true;
      return next();
    },
  );

const SENSITIVE_SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

/**
 * `.noPermission({ reason, allow })` — authenticated, deliberately
 * unchecked. The type layer refuses scoped input fields that are not
 * individually allowed with a reason; this runtime guard is the defense in
 * depth behind it, unchanged in behaviour from the legacy
 * `skipPermissionCheck`.
 */
export const declaredNoPermission = ({
  reason,
  allow,
}: {
  reason: string;
  allow?: Record<string, string>;
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "no-permission", reason, allow },
    async ({ ctx, input, next }: MiddlewareParams) => {
      const allowedKeys = Object.keys(allow ?? {});
      for (const key of SENSITIVE_SCOPE_FIELDS) {
        if (key in input && !allowedKeys.includes(key)) {
          throw new Error(`${key} is not allowed to be used without permission check`);
        }
      }
      ctx.permissionChecked = true;
      return next();
    },
  );

/**
 * `.authorizeInService({ reason, permissions })` — the scope is data the
 * handler loads at runtime, so the SERVICE performs the real authorization
 * and the declaration records which permissions it enforces. This only moves
 * WHERE the check happens, never whether one does.
 */
export const declaredServiceAuthorization = ({
  reason,
  permissions,
}: {
  reason: string;
  permissions: readonly AuthzPermission[];
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "service-authorized", reason, permissions },
    async ({ ctx, next }: MiddlewareParams) => {
      ctx.permissionChecked = true;
      return next();
    },
  );

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: ScopeInput;
  via?: ScopeTierField;
}): DeclaredScopeId {
  const scope = declaredScopeId({ permission, input, via });
  if (scope) return scope;
  throw wiringBug({ permission, via });
}

/**
 * Nothing the caller did can fix a declaration whose input carries no usable
 * id, so the sentence they read says only that; which procedure is miswired
 * goes to the log. The types make this unreachable — this is the runtime
 * backstop for the day they are bypassed.
 */
function wiringBug({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): TRPCError {
  logger.error(
    { permission, via },
    "declared permission's input carries no usable scope id",
  );
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}

/**
 * The one denial shape for every tier. An id that resolves to nothing
 * answers exactly like an id the caller may not touch — the resolvers
 * already fold both into `permitted: false`, so no probe can learn whether a
 * scope EXISTS. The lite-member cause drives the client's restriction modal;
 * the `PermissionDeniedError` cause carries the stable code and meta for
 * everything else.
 */
function deniedError({
  permission,
  scope,
  organizationRole,
}: {
  permission: AuthzPermission;
  scope: DeclaredScopeId;
  organizationRole: OrganizationUserRole | null;
}): TRPCError {
  // String comparison on purpose: a VALUE import of the Prisma enum would put
  // the generated client on this module's graph for one constant.
  if (organizationRole === "EXTERNAL") {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "This feature is not available for your account",
      cause: new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown"),
    });
  }
  const denied = new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: "no-binding",
  });
  // The wire code that results is FORBIDDEN, not the UNAUTHORIZED spelled
  // here: `handledErrorMiddleware` re-derives it from the handled cause's
  // `httpStatus` (403) — the caller IS authenticated, they just lack the
  // permission.
  return new TRPCError({
    code: "UNAUTHORIZED",
    message: denied.message,
    cause: denied,
  });
}
