/**
 * Process wiring for the `publicEnv` tRPC procedure.
 *
 * The transport itself is package-owned — `PublicEnvTrpcApi` in
 * `@langwatch/auth-server`, mounted through `@langwatch/platform-api/app-trpc`.
 * What is left here is the composition this application still owns: its tRPC
 * root, its public procedure, its authorization middlewares, and the licence
 * gated sign-in mode the deployment resolves.
 *
 * The procedure name is transitional and kept for API compatibility.
 * Deployment configuration no longer travels through it; only the viewer and
 * sign-in capability decisions that cannot be embedded in the bundle remain.
 */
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createPublicEnvTrpcProcedure, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import { resolveAuthProvider } from "~/runtime/app/features/sso";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
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

export const publicEnvRouter = createPublicEnvTrpcProcedure({
  publicProcedure: appTrpcRoot.procedure,
  middlewares,
  ports: {
    // ADR-027: the single source of truth for the sign-in mode. Never read
    // `env.NEXTAUTH_PROVIDER` directly here — a deployment whose licence gate
    // denies SSO must still be told to render the email form.
    resolveAuthProvider,
  },
});
