import type { WebhookDispatchRateLimiter, WebhookEgressService } from "@langwatch/egress";
import type { ProcessManagerApplier, ProcessStore } from "@langwatch/eventing";
import { defineServerModule, instantiateRepositories } from "@langwatch/runtime-composition";
import { toDate } from "@langwatch/time";
import type { WebhookEnvelope } from "@langwatch/webhook-contract";

import { WebhookApp } from "./app/webhook.app.ts";
import type { WebhookDispatchRequest, WebhookSecret } from "./app/webhook.app.ts";
import type { WebhookClickHouseClientResolver } from "./repositories/clickhouse/clickhouse.webhook-events.repository.ts";
import type { WebhookLiveDatabase } from "./repositories/prisma/prisma.webhook.repositories.ts";
import { webhookRepositories } from "./repositories/webhook-repositories.registry.ts";
import type {
  GatewaySpendProcessingEvent,
  IntentExecutor,
  SendBatchPayload,
} from "./rules/webhook-delivery-contract.rules.ts";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  WEBHOOK_SEND_MAX_ATTEMPTS,
} from "./rules/webhook-delivery-contract.rules.ts";
import { HttpWebhookDestinationAdapter } from "./services/http.webhook-destination.service.ts";
import type { AwsClientConfigResolver } from "./services/sqs.webhook-destination.service.ts";
import {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "./services/webhook-delivery.service.ts";
import { WebhookDestinationAdapter } from "./services/webhook-destination-dispatch.service.ts";
import {
  WebhookEnvelopeService,
  type WebhookSpendEventRow,
} from "./services/webhook-envelope.service.ts";
import { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";
import { webhookRest } from "./transport/webhook.rest.ts";

export type { WebhookAppDependencies, WebhookTestDispatch } from "./app/webhook.app.ts";
export type { WebhookLiveDatabase } from "./repositories/prisma/prisma.webhook.repositories.ts";

/** The canonical outbound-webhook feature declaration. */
export const webhookServer = defineServerModule("webhook")
  .withRepositories(webhookRepositories)
  .withApp(WebhookApp)
  .withTransports(webhookEndpointTrpcTransport, webhookRest);

/**
 * How another package composes this feature: the envelope a spend row is
 * rendered through, and the delivery graph a process runs. What the graph is
 * built from - store, sweep, transports, ladder - stays inside the feature.
 */

/** One spend row as the canonical billing envelope every destination receives. */
export interface WebhookEnvelopes {
  fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope;
}

/**
 * Names what a process cannot do, so a refusal is reported where the
 * composition decision was made rather than read as a failed delivery.
 */
export interface WebhookDeliveryAbsenceReport {
  /** No AWS transport: an endpoint that delivers to a queue is refused by name. */
  withoutQueueTransport(input: { organizationId: string; endpointId: string }): void;
}

/** The substrates a process holds before this feature can deliver anything. */
export type WebhookDeliverySubstrates = Readonly<{
  /** This process's transactional inbox and outbox. */
  processStore: ProcessStore;
  database: WebhookLiveDatabase;
  clickhouse: WebhookClickHouseClientResolver;
  /** The cipher a customer's endpoint secrets were written under. */
  secrets: WebhookSecret;
  /** The process's one SSRF-fenced outbound sender. */
  egress: WebhookEgressService;
  allowInsecureLocal: boolean;
  /**
   * How this process builds an AWS transport (proxy, TLS agent, assumed role).
   * Absent leaves a queue endpoint undeliverable; a client built here would
   * bypass a self-hosted install's own egress proxy.
   */
  awsClientConfig?: AwsClientConfigResolver | undefined;
  /**
   * The counter the hourly dispatch cap is kept in. A queue send never passes
   * through the egress sender, so it is handed the same counter directly.
   */
  dispatchRateLimiter?: WebhookDispatchRateLimiter | undefined;
  /** Which plan an organization is on: endpoints are a paid entitlement. */
  getPlan: (organizationId: string) => Promise<{ webhookEndpointsEnabled?: boolean }>;
  now?: () => number;
  absence?: WebhookDeliveryAbsenceReport | undefined;
}>;

/**
 * The feature's contribution to a process's event graph: its own delivery
 * process, and the send hop another feature's delivery process drives over the
 * same endpoints, ladder and log.
 */
export type WebhookDeliveryComposition = Readonly<{
  /** Everything both ADR-073 delivery processes read, composed once. */
  dependencies: WebhookDeliveryProcessDeps;
  deliveryProcess: Readonly<{
    name: string;
    applier: ProcessManagerApplier<GatewaySpendProcessingEvent>;
  }>;
  sendBatch: IntentExecutor<SendBatchPayload>;
  retryDelayMs: (input: { attempt: number }) => number;
  maxAttempts: number;
}>;

export function createWebhookEnvelopes(): WebhookEnvelopes {
  return WebhookEnvelopeService.create();
}

export function createWebhookDelivery(
  substrates: WebhookDeliverySubstrates,
): WebhookDeliveryComposition {
  const repositories = instantiateRepositories(webhookRepositories, {
    tier: "live",
    members: {
      prisma: substrates.database,
      clickhouse: substrates.clickhouse,
      encryption: substrates.secrets,
    },
  });

  const dependencies: WebhookDeliveryProcessDeps = {
    processStore: substrates.processStore,
    endpoints: repositories.endpoints,
    pruneExpiredIdempotencyReceipts: (now) =>
      repositories.retention.pruneExpiredIdempotencyReceipts({ now: toDate(now) }),
    dispatch: dispatchThrough(substrates),
    getPlan: substrates.getPlan,
    ...(substrates.now ? { now: substrates.now } : {}),
  };

  const delivery = WebhookDeliveryService.create(dependencies);

  return {
    dependencies,
    deliveryProcess: {
      name: WEBHOOK_DELIVERY_PROCESS_NAME,
      applier: delivery.processManager(),
    },
    sendBatch: delivery.runWebhookSendBatch(),
    retryDelayMs: (input) => WebhookDeliveryService.retryDelayMs(input),
    maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
  };
}

/**
 * The last hop for one endpoint. Both transports use the same egress fence and
 * the same signature over the same bytes, so verification keeps working when an
 * integration moves from a URL to a queue.
 */
function dispatchThrough(
  substrates: WebhookDeliverySubstrates,
): WebhookDeliveryProcessDeps["dispatch"] {
  const { egress, allowInsecureLocal, awsClientConfig } = substrates;

  return async (input) => {
    if (!awsClientConfig) {
      if (input.destination.kind === "sqs") {
        substrates.absence?.withoutQueueTransport({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        });
        return {
          verdict: "terminal",
          status: null,
          body: "",
          error: "This process composes no AWS transport for queue webhook destinations.",
        };
      }

      return HttpWebhookDestinationAdapter.create({
        url: input.destination.url,
        egress,
        allowInsecureLocal,
      }).send(dispatchRequestFor(input));
    }

    return WebhookDestinationAdapter.create({
      egress,
      allowInsecureLocal,
      awsClientConfig,
      ...(substrates.dispatchRateLimiter ? { rateLimiter: substrates.dispatchRateLimiter } : {}),
    })
      .destinationFor(input.destination)
      .send(dispatchRequestFor(input));
  };
}

/** The batch as a transport asks for it: the same bytes, either hop. */
function dispatchRequestFor(
  input: Parameters<WebhookDeliveryProcessDeps["dispatch"]>[0],
): WebhookDispatchRequest {
  return {
    organizationId: input.organizationId,
    endpointId: input.endpointId,
    body: input.body,
    batchId: input.batchId,
    attempt: input.attempt,
    signingSecrets: input.signingSecrets,
  };
}
