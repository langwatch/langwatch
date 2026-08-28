/**
 * Process wiring for the `savedViews.*` tRPC surface.
 *
 * The transport itself is package-owned — `SavedViewTrpcApi` in
 * `@langwatch/dashboard-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, and the saved-view lifecycle, which stays
 * application-owned while that vertical is drained into the Dashboard package.
 */
import {
  createSavedViewTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import type { Prisma } from "~/generated/prisma/client";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { prisma } from "../../db";
import { withSavedViewErrorHandling } from "../../saved-views/middleware";
import { SavedViewService } from "../../saved-views/saved-view.service";
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

/**
 * `withSavedViewErrorHandling` wraps each call rather than sitting in the tRPC
 * chain, so the domain errors keep mapping to the same `NOT_FOUND` the router
 * raised before the transport moved.
 */
const savedViews = SavedViewService.create(prisma);

export const savedViewsRouter = createSavedViewTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    savedViews: {
      getAll: (input) => withSavedViewErrorHandling(() => savedViews.getAll(input)),
      create: ({ projectId, ...view }) =>
        withSavedViewErrorHandling(() =>
          savedViews.createView({
            projectId,
            input: {
              ...view,
              filters: view.filters as Prisma.InputJsonValue,
              ...(view.period === undefined
                ? {}
                : { period: view.period as Prisma.InputJsonValue }),
            },
          }),
        ),
      delete: (input) => withSavedViewErrorHandling(() => savedViews.delete(input)),
      rename: (input) => withSavedViewErrorHandling(() => savedViews.rename(input)),
      reorder: (input) => withSavedViewErrorHandling(() => savedViews.reorder(input)),
    },
  },
});
