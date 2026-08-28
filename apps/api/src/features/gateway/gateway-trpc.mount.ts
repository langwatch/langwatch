/**
 * App-process transport mounts for the AI Gateway vertical.
 *
 * Behaviour is package-owned (`@langwatch/gateway-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the collaborators
 * the transports need that are neither the gateway's own services nor readable
 * from the request.
 *
 * The six routers are mounted together because they share one policy chain and
 * one ports bag, and because the ports are a single named seam: everything in
 * `GatewayTrpcPorts` is a capability still living in the application being
 * retired. When `server/gateway/*` moves into the feature package, this bag
 * shrinks to nothing and the mount collapses to root, procedure and policy.
 *
 * Personal virtual keys, routing policies and webhook endpoints are NOT here.
 * They answer from Enterprise services, and a core package may not depend on an
 * Enterprise one, so their composition lives in `@langwatch/enterprise-api`.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  GatewayBudgetTrpcApi,
  GatewayCacheRuleTrpcApi,
  GatewayGuardrailTrpcApi,
  GatewaySpendEventTrpcApi,
  GatewayUsageTrpcApi,
  VirtualKeyTrpcApi,
  type GatewayBudgetTrpcContext,
  type GatewayBudgetTrpcPorts,
  type GatewayCacheRuleTrpcContext,
  type GatewayCacheRuleTrpcPorts,
  type GatewayGuardrailTrpcContext,
  type GatewayGuardrailTrpcPorts,
  type GatewaySpendEventTrpcContext,
  type GatewaySpendEventTrpcPorts,
  type GatewayUsageTrpcContext,
  type GatewayUsageTrpcPorts,
  type VirtualKeyTrpcContext,
  type VirtualKeyTrpcPorts,
} from "@langwatch/gateway-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the six surfaces place on the process. */
export type GatewayTrpcContext = GatewayBudgetTrpcContext &
  GatewayCacheRuleTrpcContext &
  GatewayGuardrailTrpcContext &
  GatewaySpendEventTrpcContext &
  GatewayUsageTrpcContext &
  VirtualKeyTrpcContext;

/**
 * The one seam back into the application being retired.
 *
 * Each entry fronts a module under `platform/app/src/server/gateway/**` or a
 * persistence read the transports used to make directly. Nothing here is a new
 * abstraction: the names are the names of the functions the routers called.
 */
export type GatewayTrpcPorts = Readonly<{
  budgets: GatewayBudgetTrpcPorts;
  cacheRules: GatewayCacheRuleTrpcPorts;
  guardrails: GatewayGuardrailTrpcPorts;
  spendEvents: GatewaySpendEventTrpcPorts;
  usage: GatewayUsageTrpcPorts;
  virtualKeys: VirtualKeyTrpcPorts;
}>;

/**
 * Mounts `virtualKeys.*`, `gatewayUsage.*`, `gatewayBudgets.*`,
 * `gatewayCacheRules.*`, `gatewayGuardrails.*` and `gatewaySpendEvents.*` on the
 * app process's tRPC root, under the keys the clients already call.
 *
 * Two of the six authorize in their resolver rather than from the input, and
 * take the same chain under the name their package declares it by.
 */
export function createGatewayTrpcRouters<
  TContext extends GatewayTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends GatewayTrpcPorts,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<TPorts>) {
  const service = createTrpcApiService(mount);
  const resolverAuthorized = {
    protected: service.protected,
    resolverAuthorizedPolicy: service.serviceAuthorized,
  };

  return {
    virtualKeys: VirtualKeyTrpcApi.create(mount.root, resolverAuthorized, mount.ports.virtualKeys),
    gatewayUsage: GatewayUsageTrpcApi.create(mount.root, resolverAuthorized, mount.ports.usage),
    gatewayBudgets: GatewayBudgetTrpcApi.create(mount.root, service, mount.ports.budgets),
    gatewayCacheRules: GatewayCacheRuleTrpcApi.create(mount.root, service, mount.ports.cacheRules),
    gatewayGuardrails: GatewayGuardrailTrpcApi.create(mount.root, service, mount.ports.guardrails),
    gatewaySpendEvents: GatewaySpendEventTrpcApi.create(
      mount.root,
      service,
      mount.ports.spendEvents,
    ),
  };
}
