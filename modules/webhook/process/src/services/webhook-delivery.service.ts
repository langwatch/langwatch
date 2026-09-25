// SPDX-License-Identifier: Apache-2.0

import type {
  IntentContext,
  ProcessManagerApplier,
  ProcessIntent,
  ProcessStore,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";
import {
  eventMatches,
  WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
  type WebhookEndpointView,
} from "@langwatch/webhook-contract";

import type { WebhookDispatchChannel } from "../channels/webhook-dispatch.channel.ts";
import type { WebhookSpendDeliveryRequestedEvent } from "../eventing/webhook-spend-delivery.intent.ts";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  INITIAL_WEBHOOK_DELIVERY_STATE,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  deliverSchema,
  flushEndpointSchema,
  sendBatchSchema,
  type ConfirmSpendCommandData,
  type DeliverPayload,
  type FailSpendCommandData,
  type FlushEndpointPayload,
  type IntentExecutor,
  type SendBatchPayload,
  type SettleSpendCommandData,
  type WebhookDeliveryEndpointService,
  type WebhookDeliveryState,
  type WebhookDispatchResult,
} from "../rules/webhook-delivery-contract.rules.ts";
import {
  deriveEndpointFlushTarget,
  onAdmission,
  onSpendOutcome,
  payloadToRow,
  retryDelayMs,
} from "../rules/webhook-delivery-fold.rules.ts";
import {
  confirmedDeliverPayload,
  deliveryEventType,
  failedDeliverPayload,
  settledDeliverPayload,
} from "../rules/webhook-spend-payload.rules.ts";
import { HttpWebhookDestinationService } from "./http.webhook-destination.service.ts";
import { WebhookBatchSendService } from "./webhook-batch-send.service.ts";
import { WebhookDeliveryMaintenanceService } from "./webhook-delivery-maintenance.service.ts";
import type { WebhookDestinationConfig } from "./webhook-destination.service.ts";
import { WebhookEndpointStreamService } from "./webhook-endpoint-stream.service.ts";
import { WebhookEnvelopeService, type WebhookSpendEventRow } from "./webhook-envelope.service.ts";

const logger = createLogger("langwatch:webhooks:delivery-process");

/**
 * The delivery process manager consumes the spend pipeline's committed
 * events straight off the log through its transactional inbox: the inbox's
 * event-id uniqueness IS the delivery dedup, so a redelivered event never
 * re-queues an envelope and no first-sight bookkeeping exists anywhere
 * else. One process instance per gateway request: `admitted` stores the
 * attribution the outcome events do not carry, `confirmed`/`failed`/
 * `settled` freeze the full envelope source into a `deliver` intent. An
 * outcome that arrives before the admission it needs is stashed and
 * released by the admitted handler, so log order never costs a delivery.
 * Delivery is two outbox levels under this one process name: `deliver`
 * (per request) resolves the org's matching ACTIVE endpoints and commits
 * one `sendBatch` message per endpoint with a deterministic key, so each
 * endpoint retries its own Stripe ladder independently and one dead
 * endpoint never blocks another. Endpoint streams key at ORGANIZATION
 * scope, matching what an endpoint is: one buffer and one in-flight
 * budget per endpoint, fed by every project in the org.
 */

export interface WebhookDeliveryProcessDeps {
  processStore: ProcessStore;
  endpoints: WebhookDeliveryEndpointService;
  pruneExpiredIdempotencyReceipts: (now: Instant) => Promise<unknown>;
  dispatch: (input: {
    destination: WebhookDestinationConfig;
    organizationId: string;
    endpointId: string;
    body: string;
    batchId: string;
    attempt: number;
    signingSecrets: string[];
  }) => Promise<WebhookDispatchResult>;
  /** Resolves the org's active plan for the enterprise gate. */
  getPlan: (organizationId: string) => Promise<{ webhookEndpointsEnabled?: boolean }>;
  now?: () => number;
}

/**
 * Replay one already-emitted envelope to one endpoint's stream. Rides the
 * exact live-delivery machinery (buffering, coalescing, the ladder, the
 * delivery log), so a replayed delivery is operationally indistinguishable
 * from the original: same envelope, same id (the consumer's dedup key,
 * unchanged on purpose). The replayId salts the batch identity and the
 * inbox source id so re-delivering recently-delivered envelopes cannot
 * collide with their historical batches and silently no-op.
 */
export type WebhookReplayInput = {
  organizationId: string;
  endpoint: WebhookEndpointView;
  envelope: SendBatchPayload["envelopes"][number];
  replayId: string;
};

type WebhookReplayWithDependencies = WebhookReplayInput & {};

const WEBHOOK_DELIVERY_OUTBOX = {
  maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
  // An arrow, not a direct reference: this const is evaluated at module load,
  // before the class below is initialised, so naming the static here would be
  // a temporal-dead-zone ReferenceError that no type check would catch.
  retryDelayMs: (input: { attempt: number }) => retryDelayMs(input),
  // Sends are slow (a receiver can burn the full 10s timeout) and
  // parallel-safe: batches are independent, and Stripe-style receivers
  // must tolerate concurrent deliveries.
  concurrency: 4,
  batchSize: 8,
  leaseDurationMs: 120_000,
};

export class WebhookDeliveryService {
  private readonly batchSend: WebhookBatchSendService;

  private readonly maintenance: WebhookDeliveryMaintenanceService;

  private readonly stream: WebhookEndpointStreamService;

  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {
    this.batchSend = WebhookBatchSendService.create(deps);
    this.maintenance = WebhookDeliveryMaintenanceService.create(deps);
    this.stream = WebhookEndpointStreamService.create({
      processStore: deps.processStore,
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  static create(deps: WebhookDeliveryProcessDeps): WebhookDeliveryService {
    return new WebhookDeliveryService(deps);
  }

  processManager(): ProcessManagerApplier<WebhookSpendDeliveryRequestedEvent> {
    return (process) =>
      process
        .state<WebhookDeliveryState>(INITIAL_WEBHOOK_DELIVERY_STATE)
        .intent("deliver", deliverSchema, this.runDeliver())
        .intent("flushEndpoint", flushEndpointSchema, this.runFlushEndpoint())
        .intent("sendBatch", sendBatchSchema, this.runWebhookSendBatch())
        .on(WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE, (state, { spend }, context) => {
          switch (spend.type) {
            case GATEWAY_SPEND_ADMITTED_EVENT_TYPE:
              return onAdmission({ state, ctx: context, admit: spend.data });
            case GATEWAY_SPEND_CONFIRMED_EVENT_TYPE:
              return onSpendOutcome<ProcessIntent, ConfirmSpendCommandData>({
                state,
                ctx: context,
                status: "confirmed",
                data: spend.data,
                toPayload: confirmedDeliverPayload,
              });
            case GATEWAY_SPEND_FAILED_EVENT_TYPE:
              return onSpendOutcome<ProcessIntent, FailSpendCommandData>({
                state,
                ctx: context,
                status: "failed",
                data: spend.data,
                toPayload: failedDeliverPayload,
              });
            case GATEWAY_SPEND_SETTLED_EVENT_TYPE:
              return onSpendOutcome<ProcessIntent, SettleSpendCommandData>({
                state,
                ctx: context,
                status: "settled",
                data: spend.data,
                toPayload: settledDeliverPayload,
              });
          }
        })
        .onWake((state, context) => {
          const target = deriveEndpointFlushTarget(state, context.key);
          if (!target) {
            return { state };
          }

          return {
            state,
            intents: [
              context.intents.flushEndpoint(`flush:${context.at}`, {
                ...target,
                scheduledFor: context.at,
              }),
            ],
          };
        })
        .transient()
        .outbox(WEBHOOK_DELIVERY_OUTBOX);
  }

  /**
   * Main's `dispatchWebhookThrough` for a process with no AWS transport: an HTTPS endpoint
   * sends through the channel, a queue endpoint answers main's terminal refusal.
   */
  static dispatchThrough(input: {
    channel: WebhookDispatchChannel;
    allowInsecureLocal: boolean;
  }): WebhookDeliveryProcessDeps["dispatch"] {
    return (request) => {
      if (request.destination.kind === "sqs") {
        logger.error(
          { organizationId: request.organizationId, endpointId: request.endpointId },
          "webhook endpoint delivers to a queue, and this process composes no AWS transport",
        );
        return Promise.resolve({
          verdict: "terminal",
          status: null,
          body: "",
          dispatchId: request.batchId,
          error: "This process composes no AWS transport for queue webhook destinations.",
        });
      }
      return HttpWebhookDestinationService.create({
        url: request.destination.url,
        egress: input.channel,
        allowInsecureLocal: input.allowInsecureLocal,
      }).send({
        organizationId: request.organizationId,
        endpointId: request.endpointId,
        body: request.body,
        batchId: request.batchId,
        attempt: request.attempt,
        signingSecrets: request.signingSecrets,
      });
    };
  }

  /** The delay before the attempt after the 1-based `attempt` that just failed. */
  static retryDelayMs(input: { attempt: number }): number {
    return retryDelayMs(input);
  }

  /** The delivery view as a spend row; see the fold rules for what it promises. */
  static payloadToRow(payload: DeliverPayload): WebhookSpendEventRow {
    return payloadToRow(payload);
  }

  async appendReplayToEndpointStream({
    organizationId,
    endpoint,
    envelope,
    replayId,
  }: WebhookReplayWithDependencies): Promise<void> {
    await this.stream.appendReplay({ organizationId, endpoint, envelope, replayId });
  }

  /**
   * Level 1: resolve the org's ACTIVE endpoints subscribed to the event's
   * type and append the envelope to each endpoint's coalescing stream. The
   * append and any due batches commit atomically per endpoint.
   */
  runDeliver(): IntentExecutor<DeliverPayload> {
    return async (payload: DeliverPayload, _context: IntentContext): Promise<void> => {
      const organizationId = payload.attribution?.organization_id ?? "";
      if (!organizationId) {
        logger.warn(
          {
            projectId: payload.project_id,
            gatewayRequestId: payload.gateway_request_id,
          },
          "spend outcome arrived without admission attribution; skipping webhook delivery (reconciliation surfaces the row)",
        );

        return;
      }

      const plan = await this.deps.getPlan(organizationId);
      if (plan.webhookEndpointsEnabled !== true) {
        return;
      }

      const endpoints = await this.endpointsSubscribedTo({
        organizationId,
        status: payload.status,
      });
      if (endpoints.length === 0) {
        return;
      }

      const row = payloadToRow(payload);
      const envelope = WebhookEnvelopeService.fromSpendRow(
        row,
      ) as SendBatchPayload["envelopes"][number];

      for (const endpoint of endpoints) {
        await this.stream.flush({
          organizationId,
          endpoint,
          append: envelope,
          sourceEventId: `deliver:${endpoint.id}:${payload.gateway_request_id}:${payload.status}`,
        });
      }

      await this.runMaintenanceIfDue();
    };
  }

  /**
   * The wake-armed half of coalescing: ship whatever became due (delay
   * elapsed or in-flight freed) for one endpoint's stream.
   */
  runFlushEndpoint(): IntentExecutor<FlushEndpointPayload> {
    return async (payload: FlushEndpointPayload, _context: IntentContext): Promise<void> => {
      const endpoint = await this.deps.endpoints.findDeliverable({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
      });
      if (!endpoint) {
        return;
      }

      await this.stream.flush({
        organizationId: payload.organizationId,
        endpoint,
      });
    };
  }

  /**
   * Level 2: deliver one frozen batch to one endpoint through whichever
   * transport it named, and record what came back.
   */
  runWebhookSendBatch(): IntentExecutor<SendBatchPayload> {
    return this.batchSend.run();
  }

  /** The org's ACTIVE endpoints whose subscription covers this outcome. */
  private async endpointsSubscribedTo({
    organizationId,
    status,
  }: {
    organizationId: string;
    status: DeliverPayload["status"];
  }): Promise<WebhookEndpointView[]> {
    const eventType = deliveryEventType(status);
    const endpoints = await this.deps.endpoints.findActiveByOrganization({ organizationId });

    return endpoints.filter((e) => eventMatches(e.enabledEvents, eventType));
  }

  /** Runs the retention sweeps when this pod wins the hourly compare-and-set. */
  private runMaintenanceIfDue(): Promise<void> {
    return this.maintenance.runIfDue();
  }
}
