/**
 * Process wiring for the `apiKey.*` tRPC surface.
 *
 * The transport itself is package-owned — `ApiKeyTrpcApi` in
 * `@langwatch/api-key-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, and its audit trail.
 *
 * No procedure declares a permission, because no `apiKey:*` permission exists
 * to declare: a personal key belongs to its owner. The package proves
 * organization membership and, on the admin-only paths, org-admin standing
 * inside every handler, and each procedure carries the written reason that
 * records it — which is what keeps the surface declared rather than merely
 * unchecked.
 */
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createApiKeyTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";

/** This process's concrete policy chain, in the order the mount applies it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

export const apiKeyRouter = createApiKeyTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  /**
   * Fire and forget, exactly as this router has always recorded it: a
   * credential response never waits on the audit write. The minted token is
   * never among the arguments the package passes here.
   */
  recordAudit: (entry) => {
    void auditLog(entry);
  },
});
