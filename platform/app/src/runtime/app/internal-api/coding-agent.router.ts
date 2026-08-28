import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  CodingAgentTrpcApi,
  type CodingAgentTrpcRequest,
  type CodingAgentViewerVisibility,
} from "@langwatch/coding-agent-server";
import type { PrismaClient } from "~/generated/prisma/client";
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
import { getUserProtectionsForProject } from "~/server/api/utils";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import type { Session } from "~/server/auth";
import { resolveCallerProjectScope } from "~/server/organizations/resolveCallerProjectScope";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { canReadCapturedContent } from "~/server/traces/protections";

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

/**
 * What `getUserProtectionsForProject` needs to place a caller: the request's
 * database handle and its session. The package carries the request through
 * untouched, so this is the one place its concrete type is named.
 */
type ProtectionContext = {
  prisma: PrismaClient;
  session: Session | null;
  publiclyShared?: boolean;
};

/**
 * The two visibility decisions this surface takes, resolved from the project's
 * protections by the functions that own each rule: content visibility by
 * `canReadCapturedContent`, spend by the `cost:view` cut the protections
 * already carry. Throws when the policy cannot be resolved, which the package
 * reads as "not visible".
 */
async function readViewerVisibility(
  request: CodingAgentTrpcRequest,
  { projectId }: { projectId: string },
): Promise<CodingAgentViewerVisibility> {
  const protections = await getUserProtectionsForProject(request as ProtectionContext, {
    projectId,
  });
  return {
    canReadCapturedContent: canReadCapturedContent(protections),
    canSeeCosts: protections.canSeeCosts === true,
  };
}

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const codingAgentsRouter = CodingAgentTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy },
  {
    tryResolveOrganizationForProject: resolveOrganizationId,
    resolveCallerProjectScope: ({ userId, organizationId }) =>
      resolveCallerProjectScope({ userId, organizationId }),
    readViewerVisibility,
  },
);
