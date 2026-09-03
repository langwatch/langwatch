/**
 * The billing reconciliation REST family's seam, filled from this process.
 *
 * `createGatewaySpendRestApp` is four routes over the spend ledger — a cursor
 * walk, a rollup, one end user's standing, and a replay onto a webhook
 * endpoint — and it reads the SAME ledger the gateway application prices a
 * budget against, which is why the two reads are taken off the gateway
 * composition rather than opened a second time here.
 *
 * ## The three decisions this module makes
 *
 * **The plan gate is stated once, here, and it is the WEBHOOK platform's
 * flag** (ADR-072: pull and push are two views of one enterprise capability,
 * so a customer entitled to the deliveries is entitled to the pull). It is
 * built over the SAME plan provider every allowance banner on this process
 * reads, so one organization cannot be entitled on one surface and refused on
 * another. The sentence it refuses with is transcribed from the middleware it
 * replaces, not invented: a caller's own error copy quotes it.
 *
 * **The webhook trio arrives as ONE member or none.** The replay route names a
 * delivery endpoint, appends to its stream and walks the emitted-envelope log;
 * all three belong to the Enterprise webhook platform, which
 * `api-gateway-webhooks.composition.ts` builds for this process out of the
 * same registry, outbox and ClickHouse the worker's delivery process manager
 * ships from. On a deployment that composed no cipher or no database there is
 * no platform at all: the replay route then refuses by name and the other
 * three answer normally, which is the honest split — a reconciliation client
 * can still pull its spend.
 *
 * **The datastore refusal is the analytics package's own
 * `ClickHouseUnavailableError`**, the same one every other read on this
 * process raises when the instance is unreachable, rather than a second
 * taxonomy for one failure.
 */
import { ApiRestCapabilityUnavailableError } from "./api-rest-ports";
import { ClickHouseUnavailableError } from "@langwatch/analytics-server";
import { ForbiddenError } from "@langwatch/api/rest";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { eventMatches, WebhookEnvelopeService } from "@langwatch/enterprise-api/webhooks";
import {
  FixedGatewaySettlementPolicy,
  GatewayEndUserCapsAdapter,
  GatewaySpendScopeAdapter,
  type GatewaySpendRestPorts,
  type GatewaySpendWebhookDelivery,
  type GatewaySpendWebhookEndpoints,
  type GatewaySpendWebhookEvents,
} from "@langwatch/gateway-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { MiddlewareHandler } from "hono";

import type { ApiGatewayGroupCollaborators } from "./api-trpc-collaborators.gateway-group.composition";

/**
 * The Enterprise webhook platform, as the replay route reads it.
 *
 * Stated as the two members this family calls rather than as the whole
 * `WebhookApp`, so a process holding one and not the other cannot be
 * expressed: the endpoint registry says where a replay goes, and the emitted
 * log says what there is to replay.
 */
export type ApiGatewaySpendWebhookPort = Readonly<{
  endpoints: GatewaySpendWebhookEndpoints;
  events: GatewaySpendWebhookEvents | undefined;
  delivery: GatewaySpendWebhookDelivery | undefined;
}>;

export type ApiGatewaySpendRestOptions = Readonly<{
  /** The one guarded connection the scope resolution and the caps read run on. */
  prisma: PrismaClient;
  /** The gateway half's own ledger reads, so both doors price one spend. */
  gateway: Pick<ApiGatewayGroupCollaborators["composition"], "spendEvents" | "budgetSpend">;
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
 * The registry a replay names its destination in, on a process with no
 * Enterprise webhook platform.
 *
 * It REFUSES rather than answering `null`. A null would be read as "no such
 * endpoint", which tells a customer their endpoint was deleted when the truth
 * is that this deployment cannot deliver at all.
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
 *
 * Everything here is either a read the gateway half already opened or a
 * decision the process owns; nothing opens a second connection to a store
 * something else on this process is already reading.
 */
export function composeApiGatewaySpendRest(
  options: ApiGatewaySpendRestOptions,
): ApiGatewaySpendRestComposition {
  const { prisma, gateway, webhooks } = options;
  const envelopes = WebhookEnvelopeService.create();

  const ports: GatewaySpendRestPorts = {
    spendEvents: gateway.spendEvents,
    budgetSpend: gateway.budgetSpend,
    webhookEndpoints: webhooks?.endpoints ?? webhookPlatformAbsent,
    webhookEvents: webhooks?.events,
    webhookDelivery: webhooks?.delivery,
    // The wire format is the webhook platform's, and the pull and the push
    // have to answer the same bytes, so the mapping ARRIVES rather than being
    // restated here.
    spendEventEnvelope: (row) => envelopes.fromSpendRow(row),
    endpointAcceptsEvent: ({ enabledEvents, eventType }) => eventMatches(enabledEvents, eventType),
    settlementPolicy: FixedGatewaySettlementPolicy.create(options.settlementGraceMs),
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
 * ADR-072: the pull API gates under the webhook platform's plan flag, because
 * pull and push are two views of one enterprise capability.
 *
 * Fail-closed by construction: a plan lookup that rejects propagates, so a
 * deployment whose billing store is unreachable refuses the read rather than
 * admitting it.
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
