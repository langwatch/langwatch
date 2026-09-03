/**
 * The one place a process's tRPC feature mount is composed.
 *
 * A feature package owns its procedure names, input parsers and delegation,
 * and states each procedure's access decision as an `AuthzDeclaration`. It
 * does NOT own tracing, logging, error translation, scope-lineage, the
 * authorization check or the audit trail — those are the process's, and this
 * is where the process's concrete middlewares are put in the one order that
 * works.
 *
 * The mount that joins the two is the same three things in every vertical: the
 * process's one tRPC root, the procedure a feature builds on, and the policy
 * chain applied around it. `createTrpcApiService` builds that chain once, so a
 * vertical's mount is the feature's `create` call and nothing else — the same
 * shape as `createRestService` on the REST side.
 *
 * ## The ordering rule that fails silently
 *
 * tRPC appends middleware at the point it is added, and runs them in that
 * order. A check installed BEFORE `.input()` sees `input === undefined`. So
 * the policy is a function a feature applies to an ALREADY-parsed procedure:
 *
 *     policy(declaration)(procedure.input(schema)).mutation(...)
 *
 * Composed the other way round the authorization check reads no scope id, the
 * scope-lineage guard compares nothing, and the audit row lands with no
 * arguments, no project and no organization. Nothing reports an error, which
 * is exactly why the composition lives in one module instead of being
 * repeated per mount.
 *
 * The scope-lineage guard sits AHEAD of the check on purpose: a request that
 * mixes scope ids across organizations is refused before any declaration —
 * declared, custom, or opted out — can pass on one id while the handler acts
 * on another.
 */
import {
  authzDeclarationOf,
  type AuthzDeclaration,
  type AuthzPermission,
  type EnforcedScopeFields,
} from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to a feature package, so nothing here needs `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * The app's own middlewares, passed in rather than imported: they are built on
 * the app's tRPC root and typed against the app's request context, neither of
 * which this package owns.
 */
export type AppTrpcPolicyMiddlewares = Readonly<{
  tracer: unknown;
  logger: unknown;
  handledError: unknown;
  /** Refuses a request whose scope ids do not share one organization. */
  scopeLineageGuard(declaration: AuthzDeclaration): unknown;
  /**
   * The declared access check for one declaration. Carries the machine
   * readable declaration the router sweep reads, which is what keeps a
   * package-owned procedure DECLARED rather than merely unchecked.
   */
  declaredCheck(declaration: AuthzDeclaration): unknown;
  /** The fail-closed backstop: refuses a procedure no check ever ran on. */
  enforceCheck: unknown;
  /** Writes the audit row for a mutation. */
  auditMutations: unknown;
}>;

/**
 * One declaration's policy, as the feature packages consume it. Applied by the
 * feature AFTER its own input parser — see the ordering rule above.
 */
export type AppTrpcPolicy = (
  declaration: AuthzDeclaration,
) => <TProcedure>(procedure: TProcedure) => TProcedure;

/** Builds the app's policy from the app's concrete middlewares. */
export function declaredPolicy(middlewares: AppTrpcPolicyMiddlewares): AppTrpcPolicy {
  return (declaration) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as unknown as ChainableProcedure)
        .use(middlewares.tracer)
        .use(middlewares.logger)
        .use(middlewares.handledError)
        .use(middlewares.scopeLineageGuard(declaration))
        .use(middlewares.declaredCheck(declaration))
        .use(middlewares.enforceCheck)
        .use(middlewares.auditMutations) as unknown as TProcedure;
}

/**
 * The `policy(permission)` shape a feature's `<Feature>TrpcApi.create` expects:
 * one required permission, checked at the scope the validated input names.
 */
export function appTrpcPolicy(middlewares: AppTrpcPolicyMiddlewares) {
  const policy = declaredPolicy(middlewares);
  return (permission: AuthzPermission) => policy({ kind: "permission", permission });
}

/**
 * The `policyAny(...permissions)` shape: any one of the permissions is enough.
 * List the primary surface's permission first — the denial names it.
 */
export function appTrpcPolicyAny(middlewares: AppTrpcPolicyMiddlewares) {
  const policy = declaredPolicy(middlewares);
  return (...permissions: readonly [AuthzPermission, ...AuthzPermission[]]) =>
    policy({ kind: "permission-any", permissions });
}

/**
 * The `noPermission({ reason, allow })` shape: authenticated and deliberately
 * unchecked, with every scope id the input accepts allowed by name and reason.
 *
 * For a surface where no permission exists to check — a personal API key
 * belongs to its owner — and the handler proves the caller's standing itself.
 * The declaration is what keeps such a procedure reviewable rather than merely
 * unchecked, and the app's `declaredCheck` still refuses any scope id the
 * declaration does not name.
 */
export function appTrpcNoPermissionPolicy(middlewares: AppTrpcPolicyMiddlewares) {
  const policy = declaredPolicy(middlewares);
  return (declaration: { reason: string; allow?: Record<string, string> }) =>
    policy({
      kind: "no-permission",
      reason: declaration.reason,
      allow: declaration.allow ? { ...declaration.allow } : undefined,
    });
}

/**
 * The `serviceAuthorized({ reason, permissions, enforces })` shape: the scope is
 * data the handler or resolver loads at runtime, so it performs the real
 * authorization and the declaration records why plus which permissions it
 * enforces.
 *
 * This only moves WHERE the check happens, never whether one does — the
 * process's fail-closed backstop still refuses a procedure no check ran on.
 *
 * `enforces` names, per scope field, WHAT in the resolver enforces it. It has
 * to travel: the sweep counts a claimed field as covered, so a procedure whose
 * input carries a required scope id and whose claims were dropped on the way
 * through reads as unchecked and fails CI.
 */
export function appTrpcServiceAuthorizedPolicy(middlewares: AppTrpcPolicyMiddlewares) {
  const policy = declaredPolicy(middlewares);
  return (declaration: {
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }) =>
    policy({
      kind: "service-authorized",
      reason: declaration.reason,
      permissions: declaration.permissions,
      ...(declaration.enforces === undefined ? {} : { enforces: declaration.enforces }),
    });
}

/**
 * The same chain around a check the feature hands over ALREADY BUILT.
 *
 * `declaredCheckFrom` deliberately refuses `kind: "custom"`: a custom check IS
 * its own middleware, written where the rule lives, so the process passes the
 * middleware rather than a description of it. The lineage guard still reads
 * that middleware's own declaration, so a custom check is wrapped exactly like
 * a declared one and is never quietly unguarded.
 */
export function appTrpcCustomPolicy(middlewares: AppTrpcPolicyMiddlewares) {
  return (check: unknown) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as unknown as ChainableProcedure)
        .use(middlewares.tracer)
        .use(middlewares.logger)
        .use(middlewares.handledError)
        .use(middlewares.scopeLineageGuard(authzDeclarationOf(check) as AuthzDeclaration))
        .use(check)
        .use(middlewares.enforceCheck)
        .use(middlewares.auditMutations) as unknown as TProcedure;
}

// ---------------------------------------------------------------------------
// The mount
// ---------------------------------------------------------------------------

/**
 * What every feature mount takes from the process it is mounted in: the one
 * tRPC root (a feature router must never create a second), the authenticated
 * procedure it builds on, and the concrete middlewares its policy chain is
 * composed from.
 *
 * The three type parameters are load-bearing and cannot be hidden behind one.
 * `<Feature>TrpcApi.create` infers the process's real context from the root it
 * is handed; naming a fixed root type here instead would resolve every
 * procedure against the feature's own context constraint and silently narrow
 * what the client sees.
 */
export type TrpcApiMount<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/**
 * The process's PUBLIC procedure, for the handful of surfaces that are
 * deliberately reachable without a session. Intersected onto a mount rather
 * than made optional on it, so a feature that requires one cannot be mounted
 * from a process that never supplied it.
 */
export type TrpcApiPublicMount<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
}>;

/**
 * The capabilities a feature package does not own, forwarded untouched. Kept
 * as its own intersection so a vertical generic over its port types — the
 * concrete return types are what the client sees — states them once.
 */
export type TrpcApiPorts<TPorts> = Readonly<{ ports: TPorts }>;

/** One procedure, wrapped in the process's policy chain. */
type TrpcApiPolicyDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * Everything the process supplies to a feature's `<Feature>TrpcApi.create`,
 * built once from a mount.
 *
 * Every policy shape is present whether or not a given feature asks for one:
 * the value is not an object literal, so the extra keys are invisible to the
 * feature's own procedures type, and the alternative is a mount having to know
 * which shape its package declared.
 */
export type TrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The policy for one procedure, applied AFTER the feature's input parser.
   *
   * Takes a permission or a whole declaration, because that is what the
   * feature contracts ask for: most name one permission, and the ones whose
   * access rule is not a single permission state the declaration outright.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcApiPolicyDecorator;
  /** Any one of the permissions is enough; the denial names the first. */
  policyAny(
    ...permissions: readonly [AuthzPermission, ...AuthzPermission[]]
  ): TrpcApiPolicyDecorator;
  /** Authenticated and deliberately unchecked, with a written reason. */
  noPermission(declaration: {
    reason: string;
    allow?: Record<string, string>;
  }): TrpcApiPolicyDecorator;
  /** The handler or resolver does the real check; the declaration records why. */
  serviceAuthorized(declaration: {
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }): TrpcApiPolicyDecorator;
  /** The same chain around a check the feature hands over already built. */
  custom(check: unknown): TrpcApiPolicyDecorator;
}>;

/**
 * The same service, for a mount that also supplies the process's PUBLIC
 * procedure. The two are one factory with two overloads rather than two
 * functions: a mount author writes `createTrpcApiService(mount)` and gets back
 * exactly what its mount declared.
 */
export type TrpcApiPublicService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = TrpcApiService<TContext, TOptions, TRoot> &
  Readonly<{ public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"] }>;

/**
 * Builds the process side of a feature mount: the procedures the feature may
 * build on and every policy shape, composed from the process's middlewares in
 * the one order that works.
 *
 * A vertical's whole mount becomes the feature's own `create` call:
 *
 *     export function createShareTrpcRouter<
 *       TContext extends ShareTrpcContext,
 *       TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
 *       TRoot extends AnyTRPCRootTypes,
 *     >(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
 *       return ShareTrpcApi.create(mount.root, createTrpcApiService(mount));
 *     }
 */
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>,
): TrpcApiPublicService<TContext, TOptions, TRoot>;
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>): TrpcApiService<TContext, TOptions, TRoot>;
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    Partial<TrpcApiPublicMount<TContext, TOptions, TRoot>>,
): TrpcApiService<TContext, TOptions, TRoot> &
  Partial<Pick<TrpcApiPublicService<TContext, TOptions, TRoot>, "public">> {
  const declared = declaredPolicy(mount.middlewares);

  return {
    protected: mount.protectedProcedure,
    // Spread rather than set to undefined: a mount with no signed-out surface
    // must not hand a feature a `public` key at all.
    ...(mount.publicProcedure === undefined ? {} : { public: mount.publicProcedure }),
    policy: (access) =>
      declared(typeof access === "string" ? { kind: "permission", permission: access } : access),
    policyAny: (...permissions) => declared({ kind: "permission-any", permissions }),
    noPermission: (declaration) =>
      declared({
        kind: "no-permission",
        reason: declaration.reason,
        allow: declaration.allow ? { ...declaration.allow } : undefined,
      }),
    serviceAuthorized: (declaration) =>
      declared({
        kind: "service-authorized",
        reason: declaration.reason,
        permissions: declaration.permissions,
        ...(declaration.enforces === undefined ? {} : { enforces: declaration.enforces }),
      }),
    custom: appTrpcCustomPolicy(mount.middlewares),
  };
}
