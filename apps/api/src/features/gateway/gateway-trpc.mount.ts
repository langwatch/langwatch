/**
 * The six routers share one policy chain and one `GatewayTrpcPorts` seam.
 * Personal keys/routing/webhooks answer from `@langwatch/enterprise-api`.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  GatewayBudgetTrpcApi,
  type GatewayBudgetTrpcContext,
} from "@langwatch/gateway-server/api-trpc/gateway-budget";
import {
  GatewayCacheRuleTrpcApi,
  type GatewayCacheRuleTrpcContext,
} from "@langwatch/gateway-server/api-trpc/gateway-cache-rule";
import {
  GatewayGuardrailTrpcApi,
  type GatewayGuardrailTrpcContext,
} from "@langwatch/gateway-server/api-trpc/gateway-guardrail";
import {
  GatewaySpendEventTrpcApi,
  type GatewaySpendEventTrpcContext,
} from "@langwatch/gateway-server/api-trpc/gateway-spend-event";
import {
  GatewayUsageTrpcApi,
  type GatewayUsageTrpcContext,
} from "@langwatch/gateway-server/api-trpc/gateway-usage";
import {
  VirtualKeyTrpcApi,
  type VirtualKeyTrpcContext,
  type VirtualKeyTrpcSchemas,
} from "@langwatch/gateway-server/api-trpc/virtual-key";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the six surfaces place on the process. */
export type GatewayTrpcContext = GatewayBudgetTrpcContext &
  GatewayCacheRuleTrpcContext &
  GatewayGuardrailTrpcContext &
  GatewaySpendEventTrpcContext &
  GatewayUsageTrpcContext &
  VirtualKeyTrpcContext;

/**
 * A tRPC input parser is fixed when the router is built, and the application
 * is a per-request value, so the virtual-key schemas can't come off it.
 * Everything else this seam carried now lives on `GatewayApp`.
 */
export type GatewayTrpcPorts = Readonly<{
  virtualKeys: VirtualKeyTrpcSchemas;
}>;

/**
 * Mounts the six gateway namespaces under the keys clients already call. Two
 * of the six authorize in their resolver rather than from the input.
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
    validateOutput: service.validateOutput,
  };

  return {
    virtualKeys: VirtualKeyTrpcApi.create(mount.root, resolverAuthorized, mount.ports.virtualKeys),
    gatewayUsage: GatewayUsageTrpcApi.create(mount.root, resolverAuthorized),
    gatewayBudgets: GatewayBudgetTrpcApi.create(mount.root, service),
    gatewayCacheRules: GatewayCacheRuleTrpcApi.create(mount.root, service),
    gatewayGuardrails: GatewayGuardrailTrpcApi.create(mount.root, service),
    gatewaySpendEvents: GatewaySpendEventTrpcApi.create(mount.root, service),
  };
}
