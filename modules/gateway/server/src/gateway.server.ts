import { defineModule } from "@langwatch/runtime-composition";
import { GatewayApp } from "./app/gateway.app.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineModule("gateway")
  .withApp(GatewayApp)
  .withTransports(
    gatewayBudgetTrpcTransport,
    gatewayCacheRuleTrpcTransport,
    gatewayGuardrailTrpcTransport,
  )
  .build();
