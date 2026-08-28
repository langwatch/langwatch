import { AgentTrpcApi } from "@langwatch/agent-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` builds, handed
 * to the feature so it applies the policy AFTER its own input parser: tRPC runs
 * middlewares in the order they were added, and the declared check reads its
 * scope id from the validated input. `checkDeclaredPermission` carries the
 * authz declaration the router sweep reads, so these procedures stay declared.
 */
const policy =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard({ kind: "permission", permission }))
      .use(checkDeclaredPermission({ permission }))
      .use(enforcePermissionCheck)
      .use(auditLogMutations) as unknown as TProcedure;

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const agentsRouter = AgentTrpcApi.create(appTrpcRoot, {
  protected: authProtectedProcedure,
  policy,
});
