/**
 * The process-owned tRPC policy the operational routers are mounted with.
 *
 * The routers themselves are package-owned — the feature decides its procedure
 * names, input and output shapes, and which service answers. What the PROCESS
 * decides is the chain wrapped around each one: tracing, logging, handled-error
 * shaping, the scope-lineage guard, the declared authorization check, the
 * fail-closed backstop that proves a check ran at all, and the audit row.
 *
 * That chain lives in the legacy web application today, so it arrives here as a
 * kit rather than an import: this package owns the composition and never the
 * other way around.
 */
import {
  authzDeclarationOf,
  type AuthzDeclaration,
  type AuthzPermission,
} from "@langwatch/authz-contract";

/**
 * One middleware, as the process built it. Opaque on purpose: tRPC's middleware
 * generics belong to the root that produced them, and this module only ever
 * passes them back to that same root's builders.
 */
export type AppTrpcMiddleware = unknown;

/**
 * A middleware carrying the authorization declaration the router sweep reads.
 * Structurally a middleware; named separately so the chain below cannot install
 * an undeclared check by accident.
 */
export type AppTrpcDeclaredCheck = AppTrpcMiddleware;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to a feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Everything the process must hand over for an operational router to be mounted
 * with the same policy the legacy in-app routers carried.
 */
export type AppTrpcPolicyKit = Readonly<{
  tracerMiddleware: AppTrpcMiddleware;
  loggerMiddleware: AppTrpcMiddleware;
  handledErrorMiddleware: AppTrpcMiddleware;
  /** Fail-closed backstop: refuses a procedure whose check never ran. */
  enforcePermissionCheck: AppTrpcMiddleware;
  auditLogMutations: AppTrpcMiddleware;
  /** Refuses a request whose scope ids resolve to different organizations. */
  scopeLineageGuard(declaration: AuthzDeclaration | null): AppTrpcMiddleware;
  /** The declared check for one permission, read from the validated input. */
  checkDeclaredPermission(input: { permission: AuthzPermission }): AppTrpcDeclaredCheck;
  /** The declared opt-out, with the written reason the sweep records. */
  declaredNoPermission(options: {
    reason: string;
    allow?: Record<string, string>;
  }): AppTrpcDeclaredCheck;
  /**
   * The platform-tier operator check: resolves the admin allow-list into an ops
   * scope no procedure input carries. `throwOnDeny: false` reports "no access"
   * instead of refusing, which is what the status probe needs.
   */
  checkOpsPermission(input: {
    permission: AuthzPermission;
    throwOnDeny?: boolean;
  }): AppTrpcDeclaredCheck;
}>;

/**
 * The chain `protectedProcedure.input(…).permission(…)` builds, handed to a
 * feature so it applies the policy AFTER its own input parser: tRPC runs
 * middlewares in the order they were added, and the declared check, the lineage
 * guard and the audit row all read the validated input. A check installed ahead
 * of `.input()` sees no input at all, and nothing reports an error.
 */
export function policyForCheck(
  kit: AppTrpcPolicyKit,
  check: AppTrpcDeclaredCheck,
): <TProcedure>(procedure: TProcedure) => TProcedure {
  return <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(kit.tracerMiddleware)
      .use(kit.loggerMiddleware)
      .use(kit.handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(kit.scopeLineageGuard(authzDeclarationOf(check)))
      .use(check)
      .use(kit.enforcePermissionCheck)
      .use(kit.auditLogMutations) as unknown as TProcedure;
}

/** The declared-permission policy every RBAC-scoped operational router uses. */
export function permissionPolicy(
  kit: AppTrpcPolicyKit,
): (permission: AuthzPermission) => <TProcedure>(procedure: TProcedure) => TProcedure {
  return (permission: AuthzPermission) =>
    policyForCheck(kit, kit.checkDeclaredPermission({ permission }));
}
