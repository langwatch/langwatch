/**
 * Binds the gateway module's converted namespaces to this process's execution
 * path: the virtual keys a tenant mints, the usage they roll up, the budgets an
 * organization caps its spend with, the cache-control rules it serves repeat
 * traffic from, the project-scoped guardrails a key opts into, and the
 * spend-event ledger a reconciliation screen pages through.
 *
 * The six declarations come off the installed module, so the procedure
 * names, parsers and answers a client reads are the contract's own.
 */
import { bindTrpcFact, type TrpcRuntime } from "@langwatch/api/trpc";
import type { GatewayApi } from "@langwatch/gateway-contract";
import {
  gatewayBudgetTrpcTransport,
  gatewayCacheRuleTrpcTransport,
  gatewayGuardrailTrpcTransport,
  gatewaySessionFact,
  gatewaySpendEventTrpcTransport,
  gatewayUsageTrpcTransport,
  virtualKeyTrpcTransport,
} from "@langwatch/gateway-server";

/** The one slice of the process context these namespaces read. */
export interface GatewayHostContext {
  app: Readonly<{ gateway: GatewayApi }>;
  /** Opaque here: what a session IS belongs to authentication, not the gateway. */
  session?: unknown;
}

/** Mounts the five converted namespaces on the app process's tRPC runtime. */
export function createGatewayTrpcRouters<TContext extends GatewayHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  const gateway = (ctx: TContext) => ctx.app.gateway;
  // The signed-in caller as the session carries them: the per-scope virtual-key
  // checks identify an operator by more than their id, and a handler may not
  // reach for the request itself.
  const session = {
    facts: [bindTrpcFact(gatewaySessionFact, (ctx: TContext) => ctx.session ?? null)],
  };

  return {
    gatewayBudgets: runtime.mount(gatewayBudgetTrpcTransport, gateway),
    gatewayCacheRules: runtime.mount(gatewayCacheRuleTrpcTransport, gateway),
    gatewayGuardrails: runtime.mount(gatewayGuardrailTrpcTransport, gateway),
    gatewaySpendEvents: runtime.mount(gatewaySpendEventTrpcTransport, gateway),
    gatewayUsage: runtime.mount(gatewayUsageTrpcTransport, gateway),
    virtualKeys: runtime.mount(virtualKeyTrpcTransport, gateway, session),
  };
}
