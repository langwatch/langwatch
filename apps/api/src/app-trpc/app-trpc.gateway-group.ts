/**
 * The twenty-one tRPC surfaces the AI GATEWAY and the governance console that
 * steers it are administered through, mounted as one group on the process's own
 * root.
 *
 *   virtualKeys           the keys an organization issues, and what each may reach
 *   gatewayBudgets        the spend ceilings those keys run under
 *   gatewayCacheRules     what the gateway may answer from cache
 *   gatewayGuardrails     the evaluations a request is held against
 *   gatewayUsage          what the keys actually spent
 *   gatewaySpendEvents    the ledger rows behind that number
 *   personalVirtualKeys   the keys a member mints for themselves
 *   routingPolicy         which provider a key's traffic reaches
 *   webhookEndpoints      where a spend event is delivered
 *   governance            the console's own reads, and the `/` landing decision
 *   ingestionSources      where an organization's activity is pulled from
 *   ingestionTemplates    the shapes those sources are configured by
 *   ingestionKey          the credential an agent ingests with
 *   departments           the org units spend and policy are attributed to
 *   aiTools               the catalogue an organization sanctions
 *   activityMonitor       what its people did, as an administrator reads it
 *   anomalyRules          the alerts that watch the same stream
 *   personalSessions      a member's own CLI and agent sessions
 *   sessionPolicy         the rules those sessions are bounded by
 *   subscription          the plan the organization pays for
 *   currency              the currency it is quoted in
 *
 * ## Why one group rather than twenty-one entries
 *
 * They are one graph, in the way that matters at a composition root. A virtual
 * key is minted by the governance console and priced by the budget ledger; a
 * budget's spend is what a webhook endpoint delivers and what a subscription is
 * billed from; an ingestion source's traffic is what an activity monitor and an
 * anomaly rule read; a session policy bounds the very sessions a personal key
 * authenticates. Every one of them resolves through the same three
 * applications — {@link GatewayApp}, the governance capability and the webhook
 * application — and a process holding one without the others would serve a
 * console whose numbers no door agrees on.
 *
 * Naming them individually on {@link AppTrpcFeaturePorts} would put twenty-one
 * entries on a file five other halves of the record also edit; naming them once
 * here keeps that file's diff to one import, one parameter and one spread — the
 * same shape the trace, org and agent groups settled on for the same reason.
 *
 * ## The Enterprise fifteen
 *
 * Fifteen of the twenty-one are Enterprise, and they ride this group rather
 * than a group of their own for the reason the org group's Enterprise four do:
 * a core process may not depend on an Enterprise feature package, so their whole
 * seam is `@langwatch/enterprise-api` and they arrive together or not at all.
 * Their `ctx.app` slices — the governance capability, the governance
 * application, the session-policy store and the webhook application — are
 * composed by the same fold that composes the six core gateway surfaces, and
 * refuse BY NAME on a deployment that composed no Enterprise application rather
 * than answering as though it had none of those resources.
 */
import type { TrpcApiMount } from "@langwatch/api/trpc";
import type { GatewayTrpcContext, GatewayTrpcPorts } from "../features/gateway/gateway-trpc.mount";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

import { createGatewayTrpcRouters } from "../features/gateway/gateway-trpc.mount";
import {
  createEnterpriseBillingTrpcRouters,
  type EnterpriseBillingTrpcContext,
} from "../features/enterprise/enterprise-billing-trpc.mount";
import {
  createEnterpriseGovernanceTrpcRouters,
  type EnterpriseGovernanceMountContext,
} from "../features/enterprise/enterprise-governance-trpc.mount";
import {
  createGovernanceHomeTrpcRouter,
  type GovernanceHomeTrpcContext,
  type GovernanceHomeTrpcPorts,
} from "../features/enterprise/governance-home.mount";

/**
 * The request context this group is resolved against: the intersection of the
 * twenty-one surfaces' own contexts.
 *
 * Written down once for the same reason {@link ApiTrpcFeatureApplication} is —
 * so "what must a request carry for the whole group to mount" is one statement
 * rather than twenty-one compile errors.
 */
export type AppGatewayGroupTrpcContext = EnterpriseBillingTrpcContext &
  EnterpriseGovernanceMountContext &
  GatewayTrpcContext &
  GovernanceHomeTrpcContext;

/**
 * The capabilities the twenty-one surfaces reach that their own feature
 * packages do not own.
 *
 * Three entries for twenty-one namespaces, and that is the measure of how much
 * the gateway move settled: everything the old seam carried — the visibility
 * rules, the per-scope checks, the DTO projections, the budget resolvers, the
 * usage reads — now lives on {@link GatewayApp}, which the routers reach at
 * `ctx.app.gateway`.
 */
export interface AppGatewayGroupTrpcPorts {
  /**
   * The virtual-key budget parser.
   *
   * The one member that could not follow the rest onto the application: a tRPC
   * procedure's input parser is fixed when the router is BUILT and the
   * application is a per-request value, so this stays an argument.
   */
  gateway: GatewayTrpcPorts;
  /**
   * The six answers the `/` landing decision is gathered from — the member's
   * projects, the organization's plan and intent, the caller's standing, their
   * own pinned path and the console's rollout gate.
   */
  governanceHome: GovernanceHomeTrpcPorts;
  /**
   * Whether this installation bills through Stripe.
   *
   * A build-time fact rather than a per-request one, because it decides which
   * router the two billing namespaces ARE: the real surface, or the empty one
   * of the same type that says this deployment does not bill.
   */
  saasBilling: boolean;
}

/**
 * The group's ports as a composition root states them.
 *
 * A root hands the record on as a `TRPCRouterRecord` and derives nothing, so it
 * names this alias rather than restating the interface.
 */
export type AnyAppGatewayGroupTrpcPorts = AppGatewayGroupTrpcPorts;

/**
 * Builds all twenty-one surfaces against one process's mount.
 *
 * The result is keyed by the namespace each answers on, so the caller spreads
 * it into the record and adds nothing per feature.
 *
 * `governance` is the one name with two owners: the five packaged procedures
 * and this process's own landing decision, merged onto one router. Merged HERE
 * rather than at the caller so nothing outside this list can add a third door
 * onto the same name.
 */
export function createAppGatewayGroupTrpcFeatures<
  TContext extends AppGatewayGroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnyAppGatewayGroupTrpcPorts,
>(options: { mount: TrpcApiMount<TContext, TOptions, TRoot>; ports: TPorts }) {
  const { mount, ports } = options;
  const gateway = createGatewayTrpcRouters({ ...mount, ports: ports.gateway });
  const governance = createEnterpriseGovernanceTrpcRouters(mount);
  const billing = createEnterpriseBillingTrpcRouters({
    ...mount,
    saasBilling: ports.saasBilling,
  });

  return {
    activityMonitor: governance.activityMonitor,
    aiTools: governance.aiTools,
    anomalyRules: governance.anomalyRules,
    currency: billing.currency,
    departments: governance.departments,
    gatewayBudgets: gateway.gatewayBudgets,
    gatewayCacheRules: gateway.gatewayCacheRules,
    gatewayGuardrails: gateway.gatewayGuardrails,
    gatewaySpendEvents: gateway.gatewaySpendEvents,
    gatewayUsage: gateway.gatewayUsage,
    governance: mount.root.mergeRouters(
      governance.governance,
      createGovernanceHomeTrpcRouter({ ...mount, ports: ports.governanceHome }),
    ),
    ingestionKey: governance.ingestionKey,
    ingestionSources: governance.ingestionSources,
    ingestionTemplates: governance.ingestionTemplates,
    personalSessions: governance.personalSessions,
    personalVirtualKeys: governance.personalVirtualKeys,
    routingPolicy: governance.routingPolicy,
    sessionPolicy: governance.sessionPolicy,
    subscription: billing.subscription,
    virtualKeys: gateway.virtualKeys,
    webhookEndpoints: governance.webhookEndpoints,
  };
}
