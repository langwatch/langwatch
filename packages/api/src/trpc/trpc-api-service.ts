/** Apply policy after input parsing so authorization checks the validated scope. */
import {
  authzDeclarationOf,
  type AuthzDeclaration,
  type AuthzPermission,
  type EnforcedScopeFields,
} from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { TrpcHandlerBinding } from "./trpc-handler.ts";

/** The `.use()` surface every tRPC procedure builder shares, so nothing here needs `any`. */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Passed in, not imported: built on the app's tRPC root and request context,
 * neither of which this package owns.
 */
export type AppTrpcPolicyMiddlewares = Readonly<{
  tracer: unknown;
  logger: unknown;
  handledError: unknown;
  /** Refuses a request whose scope ids do not share one organization. */
  scopeLineageGuard(declaration: AuthzDeclaration): unknown;
  /** Carries the machine-readable declaration the router sweep reads. */
  declaredCheck(declaration: AuthzDeclaration): unknown;
  /** The fail-closed backstop: refuses a procedure no check ever ran on. */
  enforceCheck: unknown;
  /** Writes the audit row for a mutation. */
  auditMutations: unknown;
}>;

/** Applied by the feature AFTER its own input parser — see the ordering rule above. */
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
 * Authenticated and deliberately unchecked, for a surface with no permission
 * to check — the handler proves standing itself. `declaredCheck` still
 * refuses any scope id not named by the declaration.
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
 * For a scope the resolver loads at runtime; the fail-closed backstop still
 * refuses a procedure no check ran on. `enforces` must travel — the sweep
 * counts a claimed field as covered, so a dropped claim fails CI.
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
 * `declaredCheckFrom` refuses `kind: "custom"` — a custom check IS its own
 * middleware — but the lineage guard still reads its declaration, so it's
 * never quietly unguarded.
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

/** Process-owned tRPC dependencies for a feature mount.
 * The root and policy procedure must retain the process's inferred context.
 */
export type TrpcApiMount<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}> &
  ([TApp] extends [never]
    ? Readonly<{ validateOutput?: boolean }>
    : Readonly<{ handlerBinding: TrpcHandlerBinding<TContext, TApp>; validateOutput?: never }>);

/**
 * Intersected onto a mount, not made optional, so a feature requiring the
 * public procedure can't be mounted from a process that never supplied one.
 */
export type TrpcApiPublicMount<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
}>;

/** Capabilities a feature doesn't own, forwarded untouched. */
export type TrpcApiPorts<TPorts> = Readonly<{ ports: TPorts }>;

/** One procedure, wrapped in the process's policy chain. */
type TrpcApiPolicyDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * Every policy shape is present whether or not a feature asks for one — the
 * alternative is a mount having to know which shape its package declared.
 */
export type TrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Applied AFTER the feature's input parser. Takes a permission or a whole
   * declaration, matching what feature contracts ask for.
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
}> &
  ([TApp] extends [never]
    ? Readonly<{
        handlerBinding?: TrpcHandlerBinding<TContext, TApp>;
        /** @see the mount field of the same name. */
        validateOutput: boolean;
      }>
    : Readonly<{
        handlerBinding: TrpcHandlerBinding<TContext, TApp>;
        validateOutput?: never;
      }>);

/**
 * One factory with two overloads, not two functions: a mount author writes
 * `createTrpcApiService(mount)` and gets back what its mount declared.
 */
export type TrpcApiPublicService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
> = TrpcApiService<TContext, TOptions, TRoot, TApp> &
  Readonly<{ public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"] }>;

/**
 * Builds the process side of a feature mount, so a vertical's whole mount
 * becomes the feature's own `create` call.
 */
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot, TApp> &
    TrpcApiPublicMount<TContext, TOptions, TRoot>,
): TrpcApiPublicService<TContext, TOptions, TRoot, TApp>;
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
  TApp,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot, TApp>,
): TrpcApiService<TContext, TOptions, TRoot, TApp>;
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>): TrpcApiService<TContext, TOptions, TRoot>;
export function createTrpcApiService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
>(
  mount: Readonly<{
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    middlewares: AppTrpcPolicyMiddlewares;
    validateOutput?: boolean;
    handlerBinding?: TrpcHandlerBinding<TContext, TApp>;
  }> &
    Partial<TrpcApiPublicMount<TContext, TOptions, TRoot>>,
): Omit<TrpcApiService<TContext, TOptions, TRoot>, "handlerBinding" | "validateOutput"> &
  Readonly<{
    handlerBinding?: TrpcHandlerBinding<TContext, TApp>;
    validateOutput?: boolean;
  }> &
  Partial<Pick<TrpcApiPublicService<TContext, TOptions, TRoot>, "public">> {
  const declared = declaredPolicy(mount.middlewares);
  const governed = "handlerBinding" in mount;

  return {
    protected: mount.protectedProcedure,
    ...(governed ? { handlerBinding: mount.handlerBinding } : {}),
    ...(governed ? {} : { validateOutput: mount.validateOutput ?? false }),
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
