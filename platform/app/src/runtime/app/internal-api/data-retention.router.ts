import {
  authzDeclarationOf,
  type AuthzPermission,
  type EnforcedScopeFields,
} from "@langwatch/authz-contract";
import { DataRetentionTrpcApi } from "@langwatch/data-retention-server";
import { authorizeInResolver } from "~/server/api/rbac";
import type { TRPCContext } from "~/server/api/trpc.context";
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
import { resolveScopeStorageUsage } from "~/server/data-retention/metering/storage-meter.read";
import {
  assertCanDisableRetention,
  assertCanWriteRetentionScope,
  assertRetentionPlanForProject,
  assertRetentionPlanForScope,
  assertRetentionWriteAllowed,
  type RetentionScope,
} from "~/server/data-retention/policy/dataRetentionPolicy.authz";
import { getRetentionPolicySnapshot } from "~/server/data-retention/policy/dataRetentionPolicy.read";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** Either declared check the chain below installs, as its factory builds it. */
type DeclaredCheck =
  | ReturnType<typeof checkDeclaredPermission>
  | ReturnType<typeof authorizeInResolver>;

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` — or
 * `.use(authorizeInResolver(…))` — builds, handed to the feature so it applies
 * the policy AFTER its own input parser: tRPC runs middlewares in the order
 * they were added, and the declared check reads its scope id from the
 * validated input. The check carries the authz declaration the router sweep
 * reads, so these procedures stay declared.
 */
const policyFor =
  (check: DeclaredCheck) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard(authzDeclarationOf(check)))
      .use(check)
      .use(enforcePermissionCheck)
      .use(auditLogMutations) as unknown as TProcedure;

/**
 * The two declaration kinds this router's eight procedures were declared with
 * before they moved into the package — five a plain `.permission()`, three the
 * resolver-authorized claim, because their authorized target is `scope` rather
 * than the `projectId` they also accept.
 */
const dataRetentionAuthz = {
  permission: (permission: AuthzPermission) => policyFor(checkDeclaredPermission({ permission })),
  inResolver: (enforces: EnforcedScopeFields) => policyFor(authorizeInResolver(enforces)),
};

/**
 * Retention policy stays process-owned. Every decision below resolves
 * organization/team/project lineage and an active plan out of this process's
 * own identity and billing stores, which the retention package deliberately
 * does not reach into; the package owns the transport and the retention
 * service behind it.
 */
const dataRetentionPolicy = {
  assertCanWriteScope: (ctx: TRPCContext, scope: RetentionScope) =>
    assertCanWriteRetentionScope({ prisma: ctx.prisma, session: ctx.session }, scope),
  assertWriteAllowed: (ctx: TRPCContext, scope: RetentionScope, retentionDays: number) =>
    assertRetentionWriteAllowed(
      { prisma: ctx.prisma, session: ctx.session },
      scope,
      retentionDays,
      ctx.app.planProvider,
    ),
  assertCanDisableRetention: (ctx: TRPCContext) =>
    assertCanDisableRetention(
      { prisma: ctx.prisma, session: ctx.session },
      ctx.app.ops.operations,
    ),
  assertPlanForScope: (ctx: TRPCContext, scope: RetentionScope) =>
    assertRetentionPlanForScope(
      { prisma: ctx.prisma, session: ctx.session },
      scope,
      ctx.app.planProvider,
    ),
  assertPlanForProject: (ctx: TRPCContext, projectId: string) =>
    assertRetentionPlanForProject(
      { prisma: ctx.prisma, session: ctx.session },
      projectId,
      ctx.app.planProvider,
    ),
  getPolicySnapshot: (ctx: TRPCContext, params: { projectId: string }) =>
    getRetentionPolicySnapshot(ctx, params, ctx.app.dataRetention, ctx.app.planProvider),
  getScopeStorageUsage: (ctx: TRPCContext, params: { projectId: string; scope: RetentionScope }) =>
    resolveScopeStorageUsage(ctx, ctx.app.dataRetention, params),
};

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const dataRetentionRouter = DataRetentionTrpcApi.create(appTrpcRoot, {
  protected: authProtectedProcedure,
  authz: dataRetentionAuthz,
  policy: dataRetentionPolicy,
});
