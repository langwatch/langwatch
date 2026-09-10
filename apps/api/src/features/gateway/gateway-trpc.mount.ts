/**
 * Binds the gateway module's converted namespaces to this process's execution
 * path: the budgets an organization caps its spend with, the cache-control
 * rules it serves repeat traffic from, and the project-scoped guardrails a
 * virtual key opts into.
 *
 * The three declarations come off the installed module, so the procedure
 * names, parsers and answers a client reads are the contract's own. The other
 * three gateway namespaces - virtual keys, usage and spend events - are still
 * on the legacy builders and stay on the absence list until they convert.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { GatewayApi } from "@langwatch/gateway-contract";
import {
  gatewayBudgetTrpcTransport,
  gatewayCacheRuleTrpcTransport,
  gatewayGuardrailTrpcTransport,
} from "@langwatch/gateway-server";

/** The one slice of the process context these three namespaces read. */
export interface GatewayHostContext {
  app: Readonly<{ gateway: GatewayApi }>;
}

/** Mounts the three converted namespaces on the app process's tRPC runtime. */
export function createGatewayTrpcRouters<TContext extends GatewayHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  const gateway = (ctx: TContext) => ctx.app.gateway;

  return {
    gatewayBudgets: runtime.mount(gatewayBudgetTrpcTransport, gateway),
    gatewayCacheRules: runtime.mount(gatewayCacheRuleTrpcTransport, gateway),
    gatewayGuardrails: runtime.mount(gatewayGuardrailTrpcTransport, gateway),
  };
}
