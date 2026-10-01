import {
  bindRestCredential,
  bindRestMiddleware,
  ForbiddenError,
  keyCredentialOfRequest,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { GatewayRequestCredential } from "@langwatch/gateway-contract";
import { defineProcessModule } from "@langwatch/process";
import type { RedisConnection } from "@langwatch/redis-client";

import { GatewayModule } from "./app/gateway.app.ts";
import { gatewayGovernanceEventsEventing } from "./eventing/gateway-governance-events.pipeline.ts";
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
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
} from "./transport/gateway-platform.rest.ts";
import { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
import { gatewaySpendBillingPlanGate, gatewaySpendRest } from "./transport/gateway-spend.rest.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

/**
 * The organization a spend-plan check reads (ADR-072): off the raw request
 * the credential door recorded it against, never a context variable no door
 * here ever sets.
 */
export function gatewaySpendPlanOrganizationId(context: { req: { raw: Request } }): string {
  return organizationCredentialOfRequest(context.req.raw).organizationId;
}

export const gatewayProcessModule = defineProcessModule("gateway")
  .withApi(GatewayModule)
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
  .withEventing(gatewayGovernanceEventsEventing)
  .withEventing(gatewaySpendEventing)
  .withEventing(gatewayRealtimeSessionEventing)
  .withTransportFacts(({ app, dependencies }) => {
    if (!(app instanceof GatewayModule)) {
      throw new TypeError("Gateway transport requires its constructed application");
    }

    return [
      // The gateway control plane is signed rather than bearer-authenticated.
      // It owns the same declared secret as the data-plane client.
      bindRestCredential("internalSecret", () => app.internalDoor()),
      // Organization-owned rows take any API key; the application asks the
      // permission at the reach the operation needs.
      bindRestMiddleware(gatewayKeyCaller, (context) => keyCredentialOfRequest(context.req.raw)),
      // The callback arrives publicly and the application verifies the raw bytes
      // against the provider row's own stored secret, so the header is all the
      // transport carries.
      bindRestMiddleware(gatewayRestCredential, (context): GatewayRequestCredential => {
        const credential = projectCredentialOfRequest(context.req.raw);
        if (credential.type !== "apiKey") return { kind: "legacyProjectKey" };

        return {
          kind: "apiKey",
          apiKeyId: credential.apiKeyId,
          userId: credential.userId,
          organizationId: credential.organizationId,
        };
      }),
      bindRestMiddleware(elevenLabsSignature, (context) => ({
        signature: context.req.header("elevenlabs-signature"),
      })),
      /**
       * ADR-072: the reconciliation pull gates under the webhook platform's
       * plan flag, resolved per request after auth and the permission check.
       * Fail-closed: a rejected lookup refuses; no plan store refuses at boot.
       */
      bindRestMiddleware(gatewaySpendBillingPlanGate, async (context) => {
        const plan = await dependencies.entitlement.getActivePlan({
          organizationId: gatewaySpendPlanOrganizationId(context),
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
