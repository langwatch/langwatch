// SPDX-License-Identifier: Apache-2.0

import type {
  IntentContext,
  JsonValue,
  ProcessManagerApplier,
  ProcessIntent,
  ProcessStore,
} from "@langwatch/eventing";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { eventMatches, type WebhookEndpointView } from "@langwatch/webhook-contract";
import {
  WebhookBatchPlannerService,
  type PendingEnvelope,
} from "./webhook-batch-planner.service.ts";
import { WebhookEnvelopeService, type WebhookSpendEventRow } from "./webhook-envelope.service.ts";
import type { WebhookDestinationConfig } from "./webhook-destination.service.ts";
import { nanoUsdToDecimalString } from "@langwatch/gateway-contract";
import {
  confirmedDeliverPayload,
  deliveryEventType,
  failedDeliverPayload,
  settledDeliverPayload,
} from "../rules/webhook-spend-payload.rules.ts";

import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  INITIAL_WEBHOOK_DELIVERY_STATE,
  WEBHOOK_DELIVERY_PROCESS_NAME,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  deliverSchema,
  flushEndpointSchema,
  sendBatchSchema,
  type AdmitSpendCommandData,
  type ConfirmSpendCommandData,
  type DeliverPayload,
  type EndpointStreamState,
  type FailSpendCommandData,
  type FlushEndpointPayload,
  type GatewaySpendProcessingEvent,
  type IntentExecutor,
  type SendBatchPayload,
  type SettleSpendCommandData,
  type WebhookDeliveryEndpointService,
  type WebhookDeliveryState,
  type WebhookDispatchResult,
} from "../rules/webhook-delivery-contract.rules.ts";
import {
  endpointFlushTarget,
  onAdmission,
  onSpendOutcome,
  payloadToRow,
  retryDelayMs,
} from "../rules/webhook-delivery-fold.rules.ts";
import { WebhookBatchSendService } from "./webhook-batch-send.service.ts";
import { WebhookDeliveryMaintenanceService } from "./webhook-delivery-maintenance.service.ts";
import type { Instant } from "@langwatch/time";

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

  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {
    this.batchSend = WebhookBatchSendService.create(deps);
    this.maintenance = WebhookDeliveryMaintenanceService.create(deps);
  }

  static create(deps: WebhookDeliveryProcessDeps): WebhookDeliveryService {
    return new WebhookDeliveryService(deps);
  }

  processManager(): ProcessManagerApplier<GatewaySpendProcessingEvent> {
    return (process) =>
      process
        .state<WebhookDeliveryState>(INITIAL_WEBHOOK_DELIVERY_STATE)
        .intent("deliver", deliverSchema, this.runDeliver())
        .intent("flushEndpoint", flushEndpointSchema, this.runFlushEndpoint())
        .intent("sendBatch", sendBatchSchema, this.runWebhookSendBatch())
        .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, context) =>
          onAdmission({
            state,
            ctx: context,
            admit: data as AdmitSpendCommandData,
          }),
        )
        .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, context) =>
          onSpendOutcome<ProcessIntent, ConfirmSpendCommandData>({
            state,
            ctx: context,
            status: "confirmed",
            data: data as ConfirmSpendCommandData,
            toPayload: confirmedDeliverPayload,
          }),
        )
        .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, context) =>
          onSpendOutcome<ProcessIntent, FailSpendCommandData>({
            state,
            ctx: context,
            status: "failed",
            data: data as FailSpendCommandData,
            toPayload: failedDeliverPayload,
          }),
        )
        .on(GATEWAY_SPEND_SETTLED_EVENT_TYPE, (state, data, context) =>
          onSpendOutcome<ProcessIntent, SettleSpendCommandData>({
            state,
            ctx: context,
            status: "settled",
            data: data as SettleSpendCommandData,
            toPayload: settledDeliverPayload,
          }),
        )
        .onWake((state, context) => {
          const target = endpointFlushTarget(state, context.key);
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
        .toPayload((event) => event.data as unknown as JsonValue)
        .transient()
        .outbox(WEBHOOK_DELIVERY_OUTBOX);
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
    await this.flushEndpointStream({
      organizationId,
      endpoint,
      append: envelope,
      appendSalt: replayId,
      sourceEventId: `replay:${replayId}:${endpoint.id}:${envelope.id}`,
    });
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
        await this.flushEndpointStream({
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
      const endpoint = await this.deps.endpoints.tryGetDeliverable({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
      });
      if (!endpoint) {
        return;
      }

      await this.flushEndpointStream({
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

  /**
   * The coalescing core shared by the deliver and flush executors: append an
   * envelope (when given) to the endpoint's buffered stream, then ship as
   * many full-or-due batches as the in-flight cap allows, in one atomic
   * commit of buffer state + outbox messages.
   *
   * Redelivery safety: deliver appends carry an inbox sourceEventId (the
   * store absorbs duplicates), flushes are revision-guarded, and the batch
   * message key is a content hash, so any retry re-derives the same key and
   * the outbox suppresses it.
   */
  private async flushEndpointStream({
    organizationId,
    endpoint,
    append,
    appendSalt,
    sourceEventId,
  }: {
    organizationId: string;
    endpoint: WebhookEndpointView;
    append?: SendBatchPayload["envelopes"][number];
    appendSalt?: string;
    sourceEventId?: string;
  }): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    // Endpoints belong to the ORGANIZATION, so the stream does too: one row
    // per endpoint holds one buffer, one outstanding-send count, and
    // therefore one max_in_flight, no matter how many of the org's projects
    // feed it. Keying by project would give an endpoint N of each.
    const ref = {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: organizationId,
      processKey: `endpoint:${endpoint.id}`,
    };
    const existing = await this.deps.processStore.findByRef<EndpointStreamState>({
      ref,
    });
    const pending: PendingEnvelope[] = existing?.state.pending ? [...existing.state.pending] : [];
    if (append) {
      const item: PendingEnvelope = { envelope: append, appendedAtMs: now };
      if (appendSalt) {
        item.salt = appendSalt;
      }

      pending.push(item);
    }

    const outstanding = (await this.deps.processStore.findMessagesByRef({ ref })).filter(
      (m) => m.intentType === "sendBatch" && m.status === "pending",
    ).length;

    const planner = WebhookBatchPlannerService.create({ endpoint });
    const { messages, remaining, inFlight } = planner.plan({
      organizationId,
      pending,
      outstanding,
      now,
    });

    const result = await this.deps.processStore.commit<EndpointStreamState>({
      ref,
      tenantId: organizationId,
      sourceEventId: sourceEventId ?? null,
      expectedRevision: existing?.revision ?? 0,
      state: { pending: remaining },
      nextWakeAt: planner.tryNextWakeAt({ remaining, inFlight, now }),
      messages,
      now,
    });
    if (result.outcome === "revisionConflict") {
      // A concurrent append or flush won the stream's revision; retry this
      // intent so nothing is lost (idempotent by inbox id and content key).
      throw new Error(
        `webhook stream flush hit a revision conflict on endpoint ${endpoint.id}; retrying`,
      );
    }
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
    const endpoints = await this.deps.endpoints.getActiveByOrganization({ organizationId });

    return endpoints.filter((e) => eventMatches(e.enabledEvents, eventType));
  }

  /** Runs the retention sweeps when this pod wins the hourly compare-and-set. */
  private runMaintenanceIfDue(): Promise<void> {
    return this.maintenance.runIfDue();
  }
}
