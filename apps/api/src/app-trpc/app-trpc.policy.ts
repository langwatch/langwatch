/**
 * The one place the app's tRPC procedure policy is composed.
 *
 * A feature package owns its procedure names, input parsers and delegation,
 * and states each procedure's access decision as an `AuthzDeclaration`. It
 * does NOT own tracing, logging, error translation, scope-lineage, the
 * authorization check or the audit trail — those are the process's, and this
 * is where the process's concrete middlewares are put in the one order that
 * works.
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
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";

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
