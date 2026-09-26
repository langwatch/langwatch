import { bindRestCredential, bindRestMiddleware, ForbiddenError } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";
import type { RedisConnection } from "@langwatch/redis-client";

import { GatewayApp } from "./app/gateway.app.ts";
import { gatewayRealtimeSessionEventing } from "./eventing/gateway-realtime-session.pipeline.ts";
import { gatewaySpendEventing } from "./eventing/gateway-spend.pipeline.ts";
import { RedisGatewayBudgetChangeDedupeRepository } from "./repositories/redis/redis.gateway-budget-change-dedupe.repository.ts";
import {
  GatewayBudgetChangeDedupeService,
  type BudgetChangeEventDedupeService,
} from "./services/gateway-budget-change-dedupe.service.ts";
import { agentCacheRest } from "./transport/agent-cache.rest.ts";
import { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
import { gatewayInternalRest } from "./transport/gateway-internal.rest.ts";
import { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
import { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
import { gatewaySpendBillingPlanGate, gatewaySpendRest } from "./transport/gateway-spend.rest.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineServerModule("gateway")
  .withApp(GatewayApp)
  .withTransports(
    agentCacheRest,
    elevenLabsWebhookRest,
    gatewayInternalRest,
    gatewayBudgetTrpcTransport,
    gatewayCacheRuleTrpcTransport,
    gatewayGuardrailTrpcTransport,
    gatewayPlatformRest,
    gatewaySpendRest,
    gatewaySpendEventTrpcTransport,
    gatewayUsageTrpcTransport,
    virtualKeyTrpcTransport,
  )
  .withEventing(gatewaySpendEventing)
  .withEventing(gatewayRealtimeSessionEventing)
  .withTransportFacts(({ app, dependencies }) => {
    if (!(app instanceof GatewayApp)) {
      throw new TypeError("Gateway transport requires its constructed application");
    }

    return [
      // The gateway control plane is signed rather than bearer-authenticated.
      // It owns the same declared secret as the data-plane client.
      bindRestCredential("internalSecret", () => app.internalDoor),
      // The callback arrives publicly and the application verifies the raw bytes
      // against the provider row's own stored secret, so the header is all the
      // transport carries.
      bindRestMiddleware(elevenLabsSignature, (context) => ({
        signature: context.req.header("elevenlabs-signature"),
      })),
      /**
       * ADR-072: the reconciliation pull gates under the webhook platform's
       * plan flag, resolved per request after auth and the permission check.
       * Fail-closed: a rejected lookup refuses; no plan store refuses at boot.
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
    ];
  });

/**
 * The advisory dedupe window a spend graph debits through: without it
 * BUDGET_UPDATED fires on every debit and a busy project evicts its own gateway
 * bundles as fast as it spends. With no Redis the stand-in emits every time.
 */
export function createGatewayBudgetChangeDedupe(options: {
  redis?: RedisConnection | null | undefined;
}): BudgetChangeEventDedupeService {
  return GatewayBudgetChangeDedupeService.create(
    options.redis ? RedisGatewayBudgetChangeDedupeRepository.create(options.redis) : null,
  );
}
