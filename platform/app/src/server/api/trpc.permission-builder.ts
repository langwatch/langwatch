import type {
  inferParser,
  Parser,
  ProcedureBuilder,
  Simplify,
  UnsetMarker,
} from "@trpc/server/unstable-core-do-not-import";
import type {
  AuthzPermission,
  DeclarationError,
  DeclaredAuthzMiddleware,
  NoPermissionOptions,
  ScopeTierField,
  ValidatePermissionForInput,
  ViaFieldFor,
} from "@langwatch/authz-contract";
import { authzDeclarationOf } from "@langwatch/authz-contract";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "../app-layer/authz/trpc-middleware";
import type { PermissionMiddleware } from "./rbac";
import { appTrpcRoot } from "./trpc.root";
import { scopeLineageGuard } from "./trpc.scope-lineage-middleware";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforceUserIsAuthed,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "./trpc.runtime-policy";

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType ? TWith : Simplify<TType & TWith>;

/**
 * Typescript hackery to make sure all endpoints are forced to set the input, then to explicitly tell
 * a permission check middleware to use, and that this permission check should be compatible with the
 * inputs required
 */
interface PendingPermissionProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller extends boolean,
> {
  // Mirrors tRPC core's procedureBuilder.input typing (v11 generics)
  input: <$Parser extends Parser>(
    schema: $Parser,
  ) => PendingPermissionProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    OverwriteIfDefined<TInputIn, inferParser<$Parser>["in"]>,
    OverwriteIfDefined<TInputOut, inferParser<$Parser>["out"]>,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The custom-check escape hatch, and it only takes middleware that says
   * what it is: `declareAuthzMiddleware(...)` is the sole way to produce the
   * brand, so a hand-rolled function that flips `ctx.permissionChecked`
   * without declaring its policy is a compile error here rather than a CI
   * sweep finding. Non-authz middleware (plan gates, error handlers) belongs
   * AFTER the declaration, on the plain builder this returns.
   */
  use: (
    middleware: DeclaredAuthzMiddleware<PermissionMiddleware<TInputOut>>,
  ) => ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * ADR-092 delivery-plan decision 25: declare the required permission,
   * typed against the validated input the check reads its scope id from.
   * The permission's registry tiers decide which of `projectId` / `teamId` /
   * `organizationId` the input must carry — a missing id, or an id from a
   * tier the permission cannot be granted at, is a compile error naming the
   * problem. The most specific allowed tier present decides the check scope.
   */
  permission<P extends AuthzPermission>(
    permission: P & ValidateDeclaredPermission<P, TInputOut>,
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The derivation form, for a permission whose tier the input does not name
   * directly: `.permission("organization:manage", { via: "teamId" })` checks
   * the organization the input's team belongs to. `via` must name a required
   * input field whose tier can derive one the permission is grantable at —
   * the derivation is written at the call site, never inferred.
   */
  permission<P extends AuthzPermission>(
    permission: P,
    options: { via: ViaFieldFor<P, TInputOut> },
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * Any one of the permissions is enough, checked at the input's project
   * scope. List the primary surface's permission first — the denial names
   * it, so granting it resolves the refusal whichever feature the caller
   * came through.
   */
  permissionAny<Ps extends readonly [AuthzPermission, ...AuthzPermission[]]>(
    ...permissions: PermissionAnyArgs<Ps, TInputOut>
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * Authenticated, deliberately unchecked — for procedures that read no
   * organization-, team-, or project-scoped data. Requires a written reason,
   * and every scope id the input carries must be individually allowed with
   * one: the legacy `skipPermissionCheck` runtime guard, moved to compile
   * time.
   */
  noPermission(
    options: DeclaredNoPermissionOptions<TInputOut>,
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The scope is data the handler loads at runtime (a row's own scope set),
   * so the SERVICE performs the real authorization. The declaration records
   * why, and which permissions the service enforces — this only moves WHERE
   * the check happens, never whether one does.
   */
  authorizeInService(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
}

/**
 * `.permission()` reads its scope id from the validated input, so an input
 * must be declared first — `UnsetMarker` is tRPC's "no .input() yet".
 */
type ValidateDeclaredPermission<P extends AuthzPermission, I> = UnsetMarker extends I
  ? DeclarationError<"declare .input() before .permission() — the check reads its scope id from the validated input">
  : ValidatePermissionForInput<P, I>;

type PermissionAnyArgs<
  Ps extends readonly [AuthzPermission, ...AuthzPermission[]],
  I,
> = UnsetMarker extends I
  ? [
      AuthzPermission &
        DeclarationError<"declare .input() before .permissionAny() — the check reads its projectId from the validated input">,
    ]
  : I extends { projectId: string }
    ? {
        [K in keyof Ps]: Ps[K] & ValidatePermissionForInput<Ps[K] & AuthzPermission, I>;
      }
    : [
        AuthzPermission &
          DeclarationError<".permissionAny() checks at the project scope and needs a required 'projectId' in the input">,
      ];

type DeclaredNoPermissionOptions<I> = UnsetMarker extends I
  ? { reason: string; allow?: undefined }
  : NoPermissionOptions<I>;

const permissionProcedureBuilder = <
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller extends boolean,
>(
  procedure: ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >,
): PendingPermissionProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller
> => {
  /** The builder this call returns, named once at the tRPC type boundary. */
  type Pending = PendingPermissionProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;

  /**
   * The one chain both entry points build: the surrounding middlewares are
   * identical and only the permission check in the middle differs, so
   * `.use()` and `.permission()` cannot drift in what wraps them. Order is
   * behaviour — the check must sit inside the error/tracing middlewares and
   * before `enforcePermissionCheck`, which is what proves a check ran at all.
   */
  const withPermissionCheck = (check: DeclaredAuthzMiddleware<PermissionMiddleware<TInputOut>>) =>
    procedure
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before ANY declaration kind — declared,
      // custom, or opted-out — can pass on one id while the handler acts on
      // another. AuthZ owns the lineage decision; this is its tRPC adapter.
      .use(scopeLineageGuard(authzDeclarationOf(check)))
      .use(check)
      .use(enforcePermissionCheck)
      .use(auditLogMutations);

  const builder = {
    input(input: Parser) {
      return permissionProcedureBuilder(procedure.input(input));
    },
    use(middleware: DeclaredAuthzMiddleware<PermissionMiddleware<TInputOut>>) {
      return withPermissionCheck(middleware);
    },
    permission(permission: AuthzPermission, options?: { via?: ScopeTierField }) {
      return withPermissionCheck(checkDeclaredPermission({ permission, via: options?.via }));
    },
    permissionAny(...permissions: [AuthzPermission, ...AuthzPermission[]]) {
      return withPermissionCheck(checkDeclaredPermissionAny(permissions));
    },
    noPermission(options: { reason: string; allow?: Record<string, string> }) {
      return withPermissionCheck(declaredNoPermission(options));
    },
    authorizeInService(options: { reason: string; permissions: readonly AuthzPermission[] }) {
      return withPermissionCheck(declaredServiceAuthorization(options));
    },
  };

  // tRPC v11 has no public extension point for a procedure builder's extra
  // fluent methods. This is the sole audited structural boundary: every
  // method above delegates to the same concrete builder and keeps its exact
  // context, input, output, and caller generics. The type test exercises the
  // public root; app declaration tests cover this app-specific extension.
  return builder as Pending;
};

export const protectedProcedure = permissionProcedureBuilder(authProtectedProcedure);

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 *
 */
export const publicProcedure = permissionProcedureBuilder(appTrpcRoot.procedure);

function middlewareList(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("_middlewares" in value)) {
    return [];
  }

  const middlewares = value._middlewares;
  return Array.isArray(middlewares) ? middlewares : [];
}

/**
 * A built procedure is a **callable** carrying `_def`, not a plain object:
 * tRPC's `createResolver` returns the invoker itself. Reading it as an object
 * answered `[]` for every procedure in the router, which made
 * `isPublicProcedure` below say "public" about all of them.
 *
 * Unreadable is thrown rather than returned as empty. The one thing this
 * function must never do is shrug: an empty list reads as "no auth middleware
 * here", so a shape it does not understand would report the whole surface
 * anonymous, or — with the sense inverted — hide a genuinely public endpoint.
 */
function procedureMiddlewareList(value: unknown): readonly unknown[] {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new Error(`Not a tRPC procedure: ${typeof value}`);
  }
  if (!("_def" in value)) {
    throw new Error("tRPC procedure carries no `_def` to read its middlewares from");
  }

  const definition = (value as { _def: unknown })._def;
  if (typeof definition !== "object" || definition === null || !("middlewares" in definition)) {
    throw new Error("tRPC procedure `_def` carries no `middlewares` list");
  }

  const middlewares = (definition as { middlewares: unknown }).middlewares;
  if (!Array.isArray(middlewares)) {
    throw new Error("tRPC procedure `_def.middlewares` is not a list");
  }
  return middlewares;
}

const authMiddlewares = middlewareList(enforceUserIsAuthed);

/**
 * Whether a built procedure skips `enforceUserIsAuthed` — i.e. was built from
 * `publicProcedure` and is callable without a session. Backs the
 * public-surface allowlist test, the tripwire that makes adding a new
 * unauthenticated endpoint a deliberate, reviewed act.
 */
export function isPublicProcedure(procedure: unknown): boolean {
  const middlewares = procedureMiddlewareList(procedure);
  return !middlewares.some((middleware) => authMiddlewares.includes(middleware));
}
