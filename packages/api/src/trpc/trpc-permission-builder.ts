/**
 * The builder that makes an authorization declaration mandatory by
 * construction.
 *
 * After `.input()` a pending builder exposes only `input`, `use`, `permission`,
 * `permissionAny`, `noPermission` and `authorizeInService` — and none of
 * `.query` / `.mutation` / `.subscription`. There is no way to reach a
 * resolver without going through one of the declaring methods, each of which
 * returns the plain tRPC builder. An undeclared procedure is therefore not a
 * lint finding or a sweep failure: it does not compile.
 *
 * The chain each declaring method installs is fixed here, once, so `.use()`
 * and `.permission()` cannot drift in what wraps them. Order is behaviour: the
 * check sits inside the error and tracing middlewares, after the scope-lineage
 * guard, and before `enforcePermissionCheck`, which is what proves a check ran
 * at all.
 */
import type {
  inferParser,
  Parser,
  ProcedureBuilder,
  Simplify,
  UnsetMarker,
} from "@trpc/server/unstable-core-do-not-import";
import type {
  AuthzDeclaration,
  AuthzPermission,
  DeclarationError,
  DeclaredAuthzMiddleware,
  NoPermissionOptions,
  ScopeTierField,
  ValidatePermissionForInput,
  ViaFieldFor,
} from "@langwatch/authz-contract";
import { authzDeclarationOf } from "@langwatch/authz-contract";
import type { TrpcDeclaredAuthzMiddlewares } from "./trpc-declared-authz.js";

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType ? TWith : Simplify<TType & TWith>;

/**
 * The parameter shape a hand-written declared check receives. Supplied by the
 * process as `TCheckContext`, because a custom check reads the process's own
 * request context and this package must not invent one for it.
 *
 * `any` is load-bearing on both `next` and the return: tRPC's `.use()` accepts
 * a middleware whose result is assignable to its own `MiddlewareResult`, which
 * a check written against validated input cannot name.
 */
export type TrpcCheckMiddleware<TCheckContext, TInput> = (params: {
  ctx: TCheckContext;
  input: TInput;
  next: () => any;
}) => Promise<any>;

/**
 * The process middlewares wrapped around every declared procedure. Opaque on
 * purpose: tRPC's middleware generics belong to the root that produced them,
 * and this module only ever hands them back to that same root's builders.
 */
export type TrpcPolicyChainMiddlewares = Readonly<{
  tracer: unknown;
  logger: unknown;
  handledError: unknown;
  /** Refuses a request whose scope ids do not resolve to one organization. */
  scopeLineageGuard(declaration: AuthzDeclaration | null): unknown;
  /** The fail-closed backstop: refuses a procedure no check ever ran on. */
  enforceCheck: unknown;
  /** Writes the audit row for a mutation. */
  auditMutations: unknown;
}>;

/**
 * Typescript hackery to make sure all endpoints are forced to set the input, then to explicitly tell
 * a permission check middleware to use, and that this permission check should be compatible with the
 * inputs required
 */
export interface PendingPermissionProcedureBuilder<
  TCheckContext,
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
    TCheckContext,
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
    middleware: DeclaredAuthzMiddleware<TrpcCheckMiddleware<TCheckContext, TInputOut>>,
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

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose generics belong to
 * the caller, so nothing below needs `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * What installing a check into the chain actually requires: the declaration
 * brand, and nothing else.
 *
 * The chain builder below reads the descriptor off the check and hands the
 * function to `.use()`; it never calls it, so the context and validated-input
 * types the check is written against are the CALLER's business, checked on the
 * public `.use()` above against that procedure's own generics. Naming them
 * again here only asserted that two unrelated type parameters — the process's
 * custom-check context and the context its declared checks read — were the
 * same type, which they are not: `TrpcDeclaredCheck<TDeclaredContext>` and
 * `TrpcCheckMiddleware<TCheckContext, TInputOut>` are both installed here.
 *
 * The brand is the invariant that matters and it survives: only
 * `declareAuthzMiddleware(...)` produces it, so an undeclared function is
 * still a compile error rather than a sweep finding.
 */
type InstallableCheck = DeclaredAuthzMiddleware<(params: never) => Promise<unknown>>;

/**
 * Builds one process's declaring procedure builder.
 *
 * `TCheckContext` is the request context a hand-written custom check receives
 * through `.use()`. It is the process's, named once here, so this package
 * never has to know what else rides on that context.
 */
export function createPermissionProcedureBuilder<TCheckContext, TDeclaredContext>(
  middlewares: TrpcPolicyChainMiddlewares,
  checks: TrpcDeclaredAuthzMiddlewares<TDeclaredContext>,
) {
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
    TCheckContext,
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
      TCheckContext,
      TContext,
      TMeta,
      TContextOverrides,
      TInputIn,
      TInputOut,
      TOutputIn,
      TOutputOut,
      TCaller
    >;

    /** What every declaring method answers: the plain tRPC builder again. */
    type Declared = ProcedureBuilder<
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
     * The one chain every entry point builds: the surrounding middlewares are
     * identical and only the permission check in the middle differs, so
     * `.use()` and `.permission()` cannot drift in what wraps them. Order is
     * behaviour — the check must sit inside the error/tracing middlewares and
     * before `enforceCheck`, which is what proves a check ran at all.
     */
    const withPermissionCheck = (check: InstallableCheck): Declared =>
      (procedure as unknown as ChainableProcedure)
        .use(middlewares.tracer)
        .use(middlewares.logger)
        .use(middlewares.handledError)
        // Ahead of the check on purpose: a request mixing scope ids across
        // organizations is refused before ANY declaration kind — declared,
        // custom, or opted-out — can pass on one id while the handler acts on
        // another. AuthZ owns the lineage decision; this is its tRPC adapter.
        .use(middlewares.scopeLineageGuard(authzDeclarationOf(check)))
        .use(check)
        .use(middlewares.enforceCheck)
        .use(middlewares.auditMutations) as unknown as Declared;

    const builder = {
      input(input: Parser) {
        // tRPC types `.input()` as a conditional on the input already
        // accumulated, and this builder forwards for a procedure whose input
        // is a type parameter — the conditional never resolves, so it lands
        // on the framework's `TypeError<…>` branch. The cast is on the
        // FORWARDING seam only: the parser reaching tRPC is the caller's own,
        // and the builder returned re-derives its types from the result.
        return permissionProcedureBuilder(
          procedure.input(input as Parameters<typeof procedure.input>[0]),
        );
      },
      use(middleware: DeclaredAuthzMiddleware<TrpcCheckMiddleware<TCheckContext, TInputOut>>) {
        return withPermissionCheck(middleware);
      },
      permission(permission: AuthzPermission, options?: { via?: ScopeTierField }) {
        return withPermissionCheck(checks.permission({ permission, via: options?.via }));
      },
      permissionAny(...permissions: [AuthzPermission, ...AuthzPermission[]]) {
        return withPermissionCheck(checks.permissionAny(permissions));
      },
      noPermission(options: { reason: string; allow?: Record<string, string> }) {
        return withPermissionCheck(checks.noPermission(options));
      },
      authorizeInService(options: { reason: string; permissions: readonly AuthzPermission[] }) {
        return withPermissionCheck(checks.serviceAuthorized(options));
      },
    };

    // tRPC v11 has no public extension point for a procedure builder's extra
    // fluent methods. This is the sole audited structural boundary: every
    // method above delegates to the same concrete builder and keeps its exact
    // context, input, output, and caller generics. The type test exercises the
    // public root; app declaration tests cover this extension.
    return builder as Pending;
  };

  return permissionProcedureBuilder;
}

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

/**
 * Whether a built procedure skips the process's authentication middleware —
 * i.e. was built from the public procedure and is callable without a session.
 * Backs the public-surface allowlist test, the tripwire that makes adding a
 * new unauthenticated endpoint a deliberate, reviewed act.
 */
export function createIsPublicProcedure(
  enforceUserIsAuthed: unknown,
): (procedure: unknown) => boolean {
  const authMiddlewares = middlewareList(enforceUserIsAuthed);
  return (procedure: unknown) => {
    const middlewares = procedureMiddlewareList(procedure);
    return !middlewares.some((middleware) => authMiddlewares.includes(middleware));
  };
}
