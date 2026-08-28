/**
 * Process wiring for the `graphs.*` tRPC surface.
 *
 * The transport itself is package-owned — `GraphTrpcApi` in
 * `@langwatch/dashboard-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, the filter-field catalogue a stored graph is read
 * back against, and the automation secret redaction.
 */
import type { Trigger } from "@langwatch/automation-contract";
import {
  createGraphTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import { redactActionParamsFor } from "~/runtime/app/features/automation-adapters/providers/registry";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { filterFieldsEnum } from "../../filters/types";
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

export const graphsRouter = createGraphTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    // The catalogue of filterable trace fields is the process's filter
    // registry, so a stored graph naming a field that has since been removed is
    // dropped on read rather than shipped to a page that cannot render it.
    filterFieldSchema: filterFieldsEnum,
    // The included trigger row carries provider secrets in actionParams (the
    // encrypted Slack bot token per ADR-041, webhook header values per ADR-040
    // §3) — the same registry-driven redaction the automations router applies
    // on its own read paths.
    redactActionParams: (action: Trigger["action"], actionParams: Record<string, unknown>) =>
      redactActionParamsFor(action, actionParams) as Record<string, unknown>,
  },
});
