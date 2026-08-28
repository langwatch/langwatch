/**
 * Process wiring for the `dashboards.*` tRPC surface.
 *
 * The transport itself is package-owned — `DashboardTrpcApi` in
 * `@langwatch/dashboard-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure and
 * its authorization middlewares.
 */
import {
  createDashboardTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
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

export const dashboardsRouter = createDashboardTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
});
