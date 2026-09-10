import { defineModule } from "@langwatch/runtime-composition";
import { GatewayApp } from "./app/gateway.app.ts";
import { agentCacheRest } from "./transport/agent-cache.rest.ts";
import { elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineModule("gateway")
  .withApp(GatewayApp)
  .withTransports(
    agentCacheRest,
    elevenLabsWebhookRest,
    gatewayBudgetTrpcTransport,
    gatewayCacheRuleTrpcTransport,
    gatewayGuardrailTrpcTransport,
    gatewayUsageTrpcTransport,
    virtualKeyTrpcTransport,
  )
  .build();
