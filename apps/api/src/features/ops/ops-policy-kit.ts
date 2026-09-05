/**
 * The operator chain, assembled from the process's own middlewares plus the one gate a
 * declaration cannot describe.
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
