/**
 * The billing reconciliation REST family's seam, filled from this process.
 */
import { ApiRestCapabilityUnavailableError } from "./api-rest-ports.ts";
import { ClickHouseUnavailableError } from "@langwatch/analytics-server";
import { ForbiddenError } from "@langwatch/api/rest";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { eventMatches, WebhookEnvelopeService } from "@langwatch/webhook-server";
import type { WebhookApi } from "@langwatch/webhook-contract";
import {
  FixedGatewaySettlementPolicyAdapter,
  GatewayEndUserCapsAdapter,
  GatewaySpendScopeAdapter,
} from "@langwatch/gateway-server";
import type {
  GatewaySpendRestPorts,
  GatewaySpendWebhookDelivery,
  GatewaySpendWebhookEndpoints,
} from "@langwatch/gateway-server/api-rest/gateway-spend";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { MiddlewareHandler } from "hono";

import type { ApiGatewayComposition } from "./api-gateway.composition.ts";

/**
 * The Enterprise webhook platform, as the replay route reads it.
 */
export type ApiGatewaySpendWebhookPort = Readonly<{
  webhooks: WebhookApi;
  eventsAvailable: boolean;
  delivery: GatewaySpendWebhookDelivery | undefined;
}>;

export type ApiGatewaySpendRestOptions = Readonly<{
  /** The one guarded connection the scope resolution and the caps read run on. */
  prisma: PrismaClient;
  /** The gateway half's own ledger reads, so both doors price one spend. */
  gateway: Pick<ApiGatewayComposition, "spendEvents" | "budgetSpend">;
  /** The deployment's plan lookup, for the gate ADR-072 names. */
  plans: PlanProvider;
  /** How long after a request an outcome may still arrive, in milliseconds. */
  settlementGraceMs: number;
  /** The Enterprise webhook platform, where this process composed one. */
  webhooks?: ApiGatewaySpendWebhookPort | undefined;
}>;

export type ApiGatewaySpendRestComposition = Readonly<{
  ports: GatewaySpendRestPorts;
  billingPlanGate: MiddlewareHandler;
}>;

/**
 * The registry a replay names its destination in, on a process with no Enterprise webhook
 * platform. It REFUSES rather than answering `null`.
 */
const webhookPlatformAbsent: GatewaySpendWebhookEndpoints = {
  tryGetDeliverable: () =>
    Promise.reject(
      new ApiRestCapabilityUnavailableError(
        "webhook delivery platform, so a spend event cannot be replayed onto an endpoint",
      ),
    ),
};

/**
 * Composes the family's ports and its plan gate from this process's graph.
 */
export function composeApiGatewaySpendRest(
  options: ApiGatewaySpendRestOptions,
): ApiGatewaySpendRestComposition {
  const { prisma, gateway, webhooks } = options;
  const envelopes = WebhookEnvelopeService.create();

  const ports: GatewaySpendRestPorts = {
    spendEvents: gateway.spendEvents,
    budgetSpend: gateway.budgetSpend,
    webhookEndpoints: webhooks?.webhooks ?? webhookPlatformAbsent,
    webhookEvents: webhooks?.eventsAvailable ? webhooks.webhooks : undefined,
    webhookDelivery: webhooks?.delivery,
    // The wire format is the webhook platform's, and the pull and the push
    // have to answer the same bytes, so the mapping ARRIVES rather than being
    // restated here.
    spendEventEnvelope: (row) => envelopes.fromSpendRow(row),
    endpointAcceptsEvent: ({ enabledEvents, eventType }) => eventMatches(enabledEvents, eventType),
    settlementPolicy: FixedGatewaySettlementPolicyAdapter.create(options.settlementGraceMs),
    resolveSpendScope: (input) =>
      GatewaySpendScopeAdapter.create({ database: prisma }).resolveSpendScope(input),
    endUserCaps: ({ budgetRepository, organizationId, endUserId, tenantIds, virtualKeyId }) =>
      GatewayEndUserCapsAdapter.create({ database: prisma, spend: budgetRepository }).forEndUser({
        organizationId,
        endUserId,
        tenantIds,
        ...(virtualKeyId === undefined ? {} : { virtualKeyId }),
      }),
    spendStoreUnavailable: () => new ClickHouseUnavailableError(),
  };

  return { ports, billingPlanGate: createBillingPlanGate(options.plans) };
}

/**
 * ADR-072: the pull API gates under the webhook platform's plan flag, because pull and
 * push are two views of one enterprise capability.
 */
function createBillingPlanGate(plans: PlanProvider): MiddlewareHandler {
  return async (c, next) => {
    const organization = c.get("organization") as { id: string };
    const plan = await plans.getActivePlan({ organizationId: organization.id });
    if (plan.webhookEndpointsEnabled !== true) {
      throw new ForbiddenError(
        "The billing events API is an enterprise feature; this organization's plan does not include it.",
      );
    }
    await next();
  };
}
