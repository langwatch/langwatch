/**
 * App-process transport mounts for the fourteen Enterprise governance and
 * gateway-governance tRPC surfaces this process serves.
 *
 *   governance.*           the console's own reads: the setup rollup, the SIEM
 *                          export, the workspace-view trail, the quarantine
 *                          breakdown and the actor's personal workspace
 *   ingestionSources.*     where an organization's activity is pulled from
 *   ingestionTemplates.*   the shapes those sources are configured by
 *   ingestionKey.*         the credential an agent ingests with
 *   departments.*          the org units spend and policy are attributed to
 *   aiTools.*              the catalogue an organization sanctions
 *   activityMonitor.*      what its people did, as an administrator reads it
 *   anomalyRules.*         the alerts that watch the same stream
 *   personalDashboard.*    the /me dashboard's governance reads — merged into
 *                          `user.*` by the caller, not mounted under its own name
 *   personalSessions.*     a member's own CLI and agent sessions
 *   sessionPolicy.*        the rules those sessions are bounded by
 *   personalVirtualKeys.*  the keys a member mints for themselves
 *   routingPolicy.*        which provider a virtual key's traffic reaches
 *   webhookEndpoints.*     where a spend event is delivered
 *
 * Behaviour is package-owned and reached through TWO seams, both in
 * `@langwatch/enterprise-api`: `EnterpriseGovernanceTrpcComposition` and
 * `EnterpriseGatewayTrpcComposition`. A core process may not depend on an
 * Enterprise feature package, so the fourteen arrive together or not at all —
 * which is also why one mount builds both compositions rather than two mounts
 * building one each.
 *
 * `personalDashboard` answers on `user.*` (`user.personalUsage`,
 * `user.budgetOverview`, `user.cliBootstrap` — the /me page and CLI names),
 * not its own namespace, so this mount returns the router unmounted and
 * `app-trpc.features.ts` merges it into `user.*` with `mergeRouters`.
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

/** Every context requirement the fourteen surfaces place on the process. */
export type EnterpriseGovernanceMountContext = EnterpriseGatewayTrpcContext &
  EnterpriseGovernanceTrpcContext;

/** The fourteen Enterprise governance namespaces this process mounts. */
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
  });
  const gateway = EnterpriseGatewayTrpcComposition.create({
    root: mount.root,
    protectedProcedure: mount.protectedProcedure,
    policy,
    // Two of the three authorize in their resolver rather than from the input,
    // and take the same chain under the name their package declares it by.
    resolverAuthorizedPolicy: appTrpcServiceAuthorizedPolicy(mount.middlewares),
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
    webhookEndpoints: gateway.webhookEndpoints,
  };
}
