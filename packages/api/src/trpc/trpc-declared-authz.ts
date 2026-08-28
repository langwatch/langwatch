/**
 * ADR-092 §5, delivery-plan decision 25 — the tRPC adapter behind the typed
 * declaration surface. `protectedProcedure.input(…).permission("…")` compiles
 * down to the middleware built here.
 *
 * ONE seam, decision-neutral, properly layered: this middleware is the tRPC
 * boundary, and every decision it makes is asked of the authorization port the
 * process resolves per request — the composed permission service, which owns
 * the fork between the legacy walk and the engine. There is no shadow or
 * reverse-shadow comparison at request time; the fork is a plain if/else on the
 * gate, inside the service.
 *
 * What IS deliberately part of this seam is the denial shape: every tier's
 * refusal carries the engine's one handled code (`permission_denied`, with the
 * permission and tier in `meta`) where the legacy team/organization
 * middlewares shipped bare prose the client could only render as "unknown
 * error". Lite-member and disabled-seat denials keep their dedicated causes —
 * the client modal keys on them — and those two classes arrive through the
 * denial port, because their copy and codes are the product's.
 *
 * Every middleware built here carries an `AUTHZ_DECLARATION` descriptor, the
 * machine-readable half of the declaration: the sweep test walks the router
 * and refuses any procedure whose chain carries none.
 */
import {
  type AuthzDenialReason,
  type AuthzPermission,
  BlankScopeIdError,
  type DeclaredAuthzMiddleware,
  type DeclaredScopeId,
  declareAuthzMiddleware,
  type EnforcedScopeFields,
  PermissionDeniedError,
  resolveDeclaredScope,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type {
  TrpcActorPort,
  TrpcAuthorizationDenialPort,
  TrpcAuthorizationPort,
} from "./trpc-policy-ports.js";

const logger = createLogger("langwatch:authz");

type ScopeInput = Partial<Record<ScopeTierField, unknown>>;

/**
 * The organization role a decision reports, as this package needs it. Kept as
 * a plain string so a process whose context types the role with its own enum
 * satisfies the contract without this package importing that enum.
 */
export type TrpcOrganizationRole = string;

/**
 * What a declared check writes back onto the request context.
 *
 * `permissionChecked` is what `enforcePermissionCheck` reads: a procedure that
 * reaches its resolver without it was never checked. `organizationRole` is the
 * legacy carry-forward the project and team resolutions leave for downstream
 * code.
 */
export interface TrpcDeclaredAuthzContext {
  permissionChecked: boolean;
  organizationRole?: TrpcOrganizationRole | null;
}

/**
 * `any` here is load-bearing, not laziness: tRPC's `.use()` requires a
 * middleware whose return is assignable to its own `MiddlewareResult`, and a
 * declared check is written against the scope input rather than against one
 * procedure's generics. Narrowing either side to `unknown` makes every
 * `.use(check)` in the builder a compile error.
 */
type DeclaredCheckNext = () => any;

export type TrpcDeclaredCheckParams<TContext> = {
  ctx: TContext;
  input: ScopeInput;
  next: DeclaredCheckNext;
};

/**
 * One declared check: the middleware, carrying the machine-readable
 * declaration the router sweep reads. `declareAuthzMiddleware(...)` is the only
 * way to produce the brand, so an undeclared function cannot stand in for one.
 */
export type TrpcDeclaredCheck<TContext> = DeclaredAuthzMiddleware<
  (params: TrpcDeclaredCheckParams<TContext>) => Promise<any>
>;

const SENSITIVE_SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

/**
 * The four builders one process's declared checks are made of.
 *
 * Deliberately not parameterised on the request context: what the chain needs
 * back is an installed check, and naming the context here would make every
 * process's own middleware shape part of the contract.
 */
export interface TrpcDeclaredAuthzMiddlewares<TContext> {
  permission(
    input: Readonly<{ permission: AuthzPermission; via?: ScopeTierField }>,
  ): TrpcDeclaredCheck<TContext>;
  permissionAny(
    permissions: readonly [AuthzPermission, ...AuthzPermission[]],
  ): TrpcDeclaredCheck<TContext>;
  noPermission(
    options: Readonly<{ reason: string; allow?: Record<string, string> }>,
  ): TrpcDeclaredCheck<TContext>;
  serviceAuthorized(
    options: Readonly<{ reason: string; permissions: readonly AuthzPermission[] }>,
  ): TrpcDeclaredCheck<TContext>;
}

export type TrpcDeclaredAuthzPorts<TContext> = Readonly<{
  identity: TrpcActorPort<TContext>;
  authorization: TrpcAuthorizationPort<TContext>;
  denials: TrpcAuthorizationDenialPort;
}>;

/**
 * Writes through the narrow context this package owns rather than through the
 * process's own type parameter: a write to a generic's property is not
 * expressible, and widening the parameter would let a caller pass a context
 * these checks were never meant to mutate.
 */
function markPermissionChecked(ctx: TrpcDeclaredAuthzContext): void {
  ctx.permissionChecked = true;
}

function rememberOrganizationRole(
  ctx: TrpcDeclaredAuthzContext,
  organizationRole: TrpcOrganizationRole | null,
): void {
  ctx.organizationRole = organizationRole;
}

export function createDeclaredAuthzMiddlewares<TContext extends TrpcDeclaredAuthzContext>(
  ports: TrpcDeclaredAuthzPorts<TContext>,
): TrpcDeclaredAuthzMiddlewares<TContext> {
  /**
   * `.permission(p)` / `.permission(p, { via })`. The type layer
   * (`@langwatch/authz-contract` declaration.ts plus the permission builder)
   * guarantees the input carries a usable id; the runtime re-derives the same
   * answer and still fails loudly if the two ever disagree.
   */
  const permission = ({
    permission: required,
    via,
  }: Readonly<{
    permission: AuthzPermission;
    via?: ScopeTierField;
  }>): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "permission", permission: required, via },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        // A public procedure exposes `.permission()` too, so a session is not
        // a given. Answering "unauthenticated" before any id is looked at
        // keeps an anonymous caller from learning anything about the scope.
        const actor = ports.identity.actor(ctx);
        if (!actor) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const scope = requireDeclaredScope({ permission: required, input, via });
        const { permitted, organizationRole, denialReason } = await ports.authorization
          .forRequest(ctx)
          .getDecision({
            userId: actor.id,
            permission: required,
            scope,
          });
        if (!permitted) {
          throw deniedError({
            permission: required,
            scope,
            organizationRole,
            denialReason,
            denials: ports.denials,
          });
        }
        // Legacy parity: the organization tier never carried a role onto the
        // context, so only the project/team resolutions (non-null role) do.
        if (organizationRole !== null) {
          rememberOrganizationRole(ctx, organizationRole);
        }

        markPermissionChecked(ctx);
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
  const permissionAny = (
    permissions: readonly [AuthzPermission, ...AuthzPermission[]],
  ): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "permission-any", permissions },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        const actor = ports.identity.actor(ctx);
        if (!actor) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        // Always the project tier, so the field is named outright — but read
        // through the same resolution the single-permission seam uses, so the
        // blank-versus-missing split is decided in exactly one place.
        const { id: projectId } = requireDeclaredScope({
          permission: permissions[0],
          input,
          via: "projectId",
        });
        const { permitted, organizationRole, denialReason } = await ports.authorization
          .forRequest(ctx)
          .getProjectAnyDecision({
            userId: actor.id,
            projectId,
            permissions,
          });
        if (!permitted) {
          throw deniedError({
            permission: permissions[0],
            scope: { tier: "project", id: projectId },
            organizationRole,
            denialReason,
            denials: ports.denials,
          });
        }
        rememberOrganizationRole(ctx, organizationRole);
        markPermissionChecked(ctx);
        return next();
      },
    );

  /**
   * `.noPermission({ reason, allow })` — authenticated, deliberately
   * unchecked. The type layer refuses scoped input fields that are not
   * individually allowed with a reason; this runtime guard is the defense in
   * depth behind it, unchanged in behaviour from the legacy
   * `skipPermissionCheck`.
   */
  const noPermission = ({
    reason,
    allow,
  }: Readonly<{
    reason: string;
    allow?: Record<string, string>;
  }>): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "no-permission", reason, allow },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        const allowedKeys = Object.keys(allow ?? {});
        for (const key of SENSITIVE_SCOPE_FIELDS) {
          if (key in input && !allowedKeys.includes(key)) {
            throw new Error(`${key} is not allowed to be used without permission check`);
          }
        }
        markPermissionChecked(ctx);
        return next();
      },
    );

  /**
   * `.authorizeInService({ reason, permissions, enforces })` — the scope is
   * data the handler loads at runtime, so the SERVICE performs the real
   * authorization and the declaration records which permissions it enforces.
   * This only moves WHERE the check happens, never whether one does.
   *
   * `enforces` names, per scope field, WHAT in the resolver enforces it. The
   * sweep counts a claimed field as covered, so it has to survive this hop:
   * dropping it here leaves a resolver-authorized procedure looking like it
   * claims nothing, and a required scope id in its input then fails CI.
   */
  const serviceAuthorized = ({
    reason,
    permissions,
    enforces,
  }: Readonly<{
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }>): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      {
        kind: "service-authorized",
        reason,
        permissions,
        ...(enforces === undefined ? {} : { enforces }),
      },
      async ({ ctx, next }: TrpcDeclaredCheckParams<TContext>) => {
        markPermissionChecked(ctx);
        return next();
      },
    );

  return { permission, permissionAny, noPermission, serviceAuthorized };
}

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: ScopeInput;
  via?: ScopeTierField;
}): DeclaredScopeId {
  const resolution = resolveDeclaredScope({ permission, input, via });
  if (resolution.resolved) return resolution.scope;
  if (resolution.unresolved.reason === "blank") {
    throw blankScopeId({ field: resolution.unresolved.field });
  }
  throw wiringBug({ permission, via });
}

/**
 * The caller named the scope field and left it empty. Answered as the bad
 * request it is, rather than as the wiring bug below: a blank id is something
 * the caller can fix, and reporting it as an internal error both misleads them
 * and pages us for their typo.
 */
function blankScopeId({ field }: { field: string }): TRPCError {
  const blank = new BlankScopeIdError({ field });
  return new TRPCError({
    code: "BAD_REQUEST",
    message: blank.message,
    cause: blank,
  });
}

/**
 * The input names no scope field at all. Nothing the caller did can fix that,
 * so the sentence they read says only that; which procedure is miswired goes
 * to the log. The types make this unreachable — this is the runtime backstop
 * for the day they are bypassed.
 *
 * A field that is present and empty is NOT this: the types only ever promised
 * the field would exist, never that a caller would fill it, and treating a
 * blank id as a wiring bug is what put a routine bad request on the error
 * dashboard at ERROR severity. That case answers through `blankScopeId`.
 */
function wiringBug({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): TRPCError {
  logger.error({ permission, via }, "declared permission's input carries no usable scope id");
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
  denialReason,
  denials,
}: {
  permission: AuthzPermission;
  scope: DeclaredScopeId;
  organizationRole: TrpcOrganizationRole | null;
  denialReason?: AuthzDenialReason;
  denials: TrpcAuthorizationDenialPort;
}): TRPCError {
  // Checked before the role, because a disabled member HAS a role and the
  // role-shaped answers would all be wrong for them: the lite-member modal
  // offers an upgrade they cannot buy, and the generic denial names a
  // permission nobody can grant them while the seat is off.
  if (denialReason === "membership-disabled") {
    const disabled = denials.membershipDisabled();
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: disabled.message,
      cause: disabled,
    });
  }
  // String comparison on purpose: a VALUE import of the organization role enum
  // would put the generated Prisma client on this module's graph for one
  // constant.
  if (organizationRole === "EXTERNAL") {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "This feature is not available for your account",
      cause: denials.liteMemberRestricted(permission.split(":")[0] ?? "unknown"),
    });
  }
  const denied = new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: denialReason ?? "no-binding",
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
