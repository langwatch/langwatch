import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { GatewayApp } from "./app/gateway.app.ts";
import { agentCacheRest } from "./transport/agent-cache.rest.ts";
import { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
import { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
import {
  gatewaySpendBillingPlanGate,
  gatewaySpendRest,
} from "./transport/gateway-spend.rest.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";
import { ForbiddenError } from "@langwatch/api/rest";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineServerModule("gateway")
  .withApp(GatewayApp)
  .withTransports(
    agentCacheRest,
    elevenLabsWebhookRest,
    gatewayBudgetTrpcTransport,
    gatewayCacheRuleTrpcTransport,
    gatewayGuardrailTrpcTransport,
    gatewayPlatformRest,
    gatewaySpendRest,
    gatewayUsageTrpcTransport,
    virtualKeyTrpcTransport,
  )
  .withTransportFacts(({ dependencies }) => [
    // The callback arrives publicly and the application verifies the raw bytes
    // against the provider row's own stored secret, so the header is all the
    // transport carries.
    bindRestMiddleware(elevenLabsSignature, (context) => ({
      signature: context.req.header("elevenlabs-signature"),
    })),
    /**
     * ADR-072: the reconciliation pull gates under the webhook platform's own
     * plan flag, because pull and push are two views of one enterprise
     * capability. Read through the SAME `entitlement` peer the application
     * declared, resolved per request after authentication and after the
     * permission check — the ordering the pre-conversion per-route gate held.
     *
     * Fail-closed: a plan lookup that rejects refuses the request. There is no
     * branch that passes without an answer, and the peer is a declared
     * dependency, so a process that composed no plan store never reaches here
     * — it refuses at boot naming the module and the peer.
     */
    bindRestMiddleware(gatewaySpendBillingPlanGate, async (context) => {
      const organization = context.get("organization") as { id: string };
      const plan = await dependencies.entitlement.getActivePlan({
        organizationId: organization.id,
      });
      if (plan.webhookEndpointsEnabled !== true) {
        throw new ForbiddenError(
          "The billing events API is an enterprise feature; this organization's plan does not include it.",
        );
      }

      return {};
    }),
  ]);
