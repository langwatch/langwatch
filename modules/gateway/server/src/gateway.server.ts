import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { GatewayApp } from "./app/gateway.app.ts";
import { agentCacheRest } from "./transport/agent-cache.rest.ts";
import { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineServerModule("gateway")
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
  // The callback arrives publicly and the application verifies the raw bytes
  // against the provider row's own stored secret, so the header is all the
  // transport carries.
  .withTransportFacts(() => [
    bindRestMiddleware(elevenLabsSignature, (context) => ({
      signature: context.req.header("elevenlabs-signature"),
    })),
  ])
  .build();
