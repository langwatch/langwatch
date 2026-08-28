/**
 * Process wiring for the `group.*` tRPC surface.
 *
 * The transport itself is package-owned — `GroupTrpcApi` in
 * `@langwatch/organization-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure,
 * its authorization middlewares, and the Enterprise plan gate behind groups,
 * which reads this process's billing store.
 */
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createGroupTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import type { TRPCContext } from "~/server/api/trpc.context";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "@langwatch/enterprise-plan-gate";
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

export const groupRouter = createGroupTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    // Groups arrive with SCIM, and the plan is read per organization out of
    // this process's billing store.
    assertScimAllowed: (ctx: TRPCContext, { organizationId }) =>
      assertEnterprisePlan({
        planProvider: ctx.app.planProvider,
        organizationId,
        user: ctx.session?.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      }),
  },
});
