/**
 * `personalDashboard`'s router is returned unmounted —
 * `app-trpc.features.ts` merges it into `user.*` instead.
 */
import {
  EnterpriseGatewayTrpcComposition,
  EnterpriseGovernanceTrpcComposition,
  type EnterpriseGatewayTrpcContext,
  type EnterpriseGovernanceTrpcContext,
} from "@langwatch/enterprise-api";
import {
  appTrpcPolicy,
  appTrpcServiceAuthorizedPolicy,
  type TrpcApiMount,
} from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the thirteen surfaces place on the process. */
export type EnterpriseGovernanceMountContext = EnterpriseGatewayTrpcContext &
  EnterpriseGovernanceTrpcContext;

/** The thirteen Enterprise governance namespaces this process mounts. */
export function createEnterpriseGovernanceTrpcRouters<
  TContext extends EnterpriseGovernanceMountContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const policy = appTrpcPolicy(mount.middlewares);
  const governance = EnterpriseGovernanceTrpcComposition.create({
    root: mount.root,
    protectedProcedure: mount.protectedProcedure,
    policy,
    validateOutput: mount.validateOutput ?? false,
  });
  const gateway = EnterpriseGatewayTrpcComposition.create({
    root: mount.root,
    protectedProcedure: mount.protectedProcedure,
    policy,
    // Two of the three authorize in their resolver rather than from the input,
    // and take the same chain under the name their package declares it by.
    resolverAuthorizedPolicy: appTrpcServiceAuthorizedPolicy(mount.middlewares),
    validateOutput: mount.validateOutput ?? false,
  });

  return {
    activityMonitor: governance.activityMonitor,
    aiTools: governance.aiTools,
    anomalyRules: governance.anomalyRules,
    departments: governance.departments,
    governance: governance.governance,
    ingestionKey: governance.ingestionKey,
    ingestionSources: governance.ingestionSources,
    ingestionTemplates: governance.ingestionTemplates,
    personalDashboard: governance.personalDashboard,
    personalSessions: governance.personalSessions,
    personalVirtualKeys: gateway.personalVirtualKeys,
    routingPolicy: gateway.routingPolicy,
    sessionPolicy: governance.sessionPolicy,
  };
}
