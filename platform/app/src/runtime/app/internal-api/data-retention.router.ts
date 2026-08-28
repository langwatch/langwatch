import { DataRetentionTrpcApi } from "@langwatch/data-retention-server";
import type { TRPCContext } from "~/server/api/trpc.context";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
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

const featureProcedure = appTrpcRoot.procedure
  .use(tracerMiddleware)
  .use(loggerMiddleware)
  .use(handledErrorMiddleware)
  // No single declaration covers this router: the reads are project-tier while
  // the scope-targeted writes authorize the organization, team or project named
  // by `scope`, so the guard is installed without one rather than under a
  // permission it does not enforce.
  .use(scopeLineageGuard(null))
  .use(auditLogMutations);

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
    assertCanDisableRetention({ prisma: ctx.prisma, session: ctx.session }, ctx.app.ops),
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
  getScopeStorageUsage: (
    ctx: TRPCContext,
    params: { projectId: string; scope: RetentionScope },
  ) => resolveScopeStorageUsage(ctx, ctx.app.dataRetention, params),
};

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const dataRetentionRouter = DataRetentionTrpcApi.create(appTrpcRoot, {
  protected: featureProcedure,
  policy: dataRetentionPolicy,
});
