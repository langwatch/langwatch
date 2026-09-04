/**
 * The operator chain, assembled from the process's own middlewares plus the
 * one gate a declaration cannot describe.
 *
 * Everything but `checkOpsPermission` is the SAME middleware every other
 * procedure on this root carries — the tracer, the logger, the handled-error
 * shaping, the scope-lineage guard, the fail-closed backstop and the audit
 * row — read straight off the mount rather than restated, so the operator
 * surface cannot drift into a chain of its own.
 *
 * It lives beside the ops feature rather than in the record's own file because
 * it is this feature's chain and nothing else builds one.
 */
import type { TrpcApiMount } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";

import type { AppTrpcDeclaredCheck, AppTrpcPolicyKit } from "../../app-trpc/app-trpc.policy-kit";

export function opsPolicyKit(
  middlewares: TrpcApiMount<never, never, never>["middlewares"],
  opsCheck: (input: { permission: AuthzPermission; throwOnDeny?: boolean }) => AppTrpcDeclaredCheck,
): AppTrpcPolicyKit {
  return {
    tracerMiddleware: middlewares.tracer,
    loggerMiddleware: middlewares.logger,
    handledErrorMiddleware: middlewares.handledError,
    enforcePermissionCheck: middlewares.enforceCheck,
    auditLogMutations: middlewares.auditMutations,
    scopeLineageGuard: (declaration) =>
      middlewares.scopeLineageGuard(declaration as AuthzDeclaration),
    checkDeclaredPermission: ({ permission }) =>
      middlewares.declaredCheck({ kind: "permission", permission }),
    declaredNoPermission: ({ reason, allow }) =>
      middlewares.declaredCheck({
        kind: "no-permission",
        reason,
        ...(allow ? { allow: { ...allow } } : {}),
      }),
    checkOpsPermission: opsCheck,
  };
}
