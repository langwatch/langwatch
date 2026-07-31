// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { PlanInfo } from "../../licensing/planInfo";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type {
  NewOutboxMessage,
  ProcessStore,
} from "~/server/event-sourcing/process-manager/stores/processStore.types";
import {
  assertWebhookDelivered,
  sendWebhook,
} from "~/server/app-layer/automations/delivery/sendWebhook";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";
import type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  FailSpendCommandData,
  SettleSpendCommandData,
  SpendUsage,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import type { GatewaySpendProcessingEvent } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/events";
import {
  NANO_USD_PER_USD,
  rateSpendNanoUsd,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { spendRowToEnvelope } from "../envelope";
import { eventMatches } from "../eventRegistry";
import type {
  WebhookEndpointService,
  WebhookEndpointView,
} from "../webhookEndpoint.service";

const logger = createLogger("langwatch:webhooks:delivery-process");

export const WEBHOOK_DELIVERY_PROCESS_NAME = "webhookDelivery" as const;

/**
 * The Stripe-shaped retry ladder. `attempt` is the 1-based attempt that
 * just failed: the delay to the next one. After the sixth failure the
 * cadence holds at 12h; 11 attempts keep the last retry inside 72h of the
 * first failure (1m + 5m + 30m + 2h + 6h + 12h + 4 * 12h = 68h36m).
 */
export const WEBHOOK_RETRY_LADDER_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];
export const WEBHOOK_SEND_MAX_ATTEMPTS = 11;

export function webhookRetryDelayMs({ attempt }: { attempt: number }): number {
  return (
    WEBHOOK_RETRY_LADDER_MS[attempt - 1] ??
    WEBHOOK_RETRY_LADDER_MS[WEBHOOK_RETRY_LADDER_MS.length - 1]!
  );
}

/** How soon a stream capped on in-flight rechecks, and the floor for a
 *  delay-armed wake. Batching never waits longer than the endpoint's own
 *  max_batch_delay_ms; this only bounds the retry cadence while capped. */
export const WEBHOOK_FLUSH_RECHECK_MS = 500;
/** Dispatched outbox rows older than this are pruned by maintenance. */
const OUTBOX_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Maintenance cadence: the winner of the hourly CAS runs the sweeps. */
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const MAINTENANCE_PROCESS_KEY = "maintenance";
/** In-process throttle so the hot deliver path checks the CAS row at most
 *  once a minute per pod. */
let maintenanceLastCheckedMs = 0;

/**
 * The delivery process manager consumes the spend pipeline's committed
 * events straight off the log through its transactional inbox: the inbox's
 * event-id uniqueness IS the delivery dedup, so a redelivered event never
 * re-queues an envelope and no first-sight bookkeeping exists anywhere
 * else. One process instance per gateway request: `admitted` stores the
 * attribution the outcome events do not carry, `confirmed`/`failed`/
 * `settled` freeze the full envelope source into a `deliver` intent.
 * Delivery is two outbox levels under this one process name: `deliver`
 * (per request) resolves the org's matching ACTIVE endpoints and commits
 * one `sendBatch` message per endpoint with a deterministic key, so each
 * endpoint retries its own Stripe ladder independently and one dead
 * endpoint never blocks another.
 */

/** Attribution captured at admission; outcome events carry only the
 *  outcome. Field names mirror the admit command's wire shape. */
export interface SpendAttribution {
  organization_id: string;
  virtual_key_id: string;
  principal_user_id: string;
  end_user_id: string;
  model: string;
  model_provider_id: string;
  trace_id: string;
  request_type: string;
  labels: string[];
  metadata: string;
  admitted_at: number;
}

export interface WebhookDeliveryState {
  attribution: SpendAttribution | null;
}

export const INITIAL_WEBHOOK_DELIVERY_STATE: WebhookDeliveryState = {
  attribution: null,
};

/** A buffered envelope with its arrival instant, for the coalescing
 *  deadline and the lag (oldest-undelivered) metric. */
export interface PendingEnvelope {
  envelope: SendBatchPayload["envelopes"][number];
  appendedAtMs: number;
}

/**
 * The per-endpoint stream instance (processKey `endpoint:<id>`), committed
 * directly through the ProcessStore by the deliver and flush executors.
 * Holds the coalescing buffer; everything shipped lives in outbox messages.
 */
export interface EndpointStreamState {
  pending: PendingEnvelope[];
}

export function isEndpointStreamKey(processKey: string): boolean {
  return processKey.startsWith("endpoint:");
}

const spendUsagePayloadSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_input_tokens: z.number().int().min(0),
  cache_creation_input_tokens: z.number().int().min(0),
  reasoning_tokens: z.number().int().min(0),
});

/** Everything the deliver executor needs to rate, build the envelope, and
 *  fan out, frozen at evolve time from state + the outcome event. */
export const deliverSchema = z.object({
  gateway_request_id: z.string(),
  project_id: z.string(),
  status: z.enum(["confirmed", "failed", "settled"]),
  occurred_at: z.number().int().positive(),
  attribution: z
    .object({
      organization_id: z.string(),
      virtual_key_id: z.string(),
      principal_user_id: z.string(),
      end_user_id: z.string(),
      model: z.string(),
      model_provider_id: z.string(),
      trace_id: z.string(),
      request_type: z.string(),
      labels: z.array(z.string()),
      metadata: z.string(),
      admitted_at: z.number(),
    })
    .nullable(),
  /** The RESOLVED model identity from the outcome event, when it carried
   *  one; wins over the admitted (requested) identity. */
  model: z.string(),
  model_provider_id: z.string(),
  usage: spendUsagePayloadSchema.nullable(),
  rate_version: z.string(),
  duration_ms: z.number().int().min(0),
  error: z
    .object({ type: z.string(), http_status: z.number().int() })
    .nullable(),
  settle_reason: z.string().nullable(),
});
export type DeliverPayload = z.infer<typeof deliverSchema>;

export const sendBatchSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  endpointId: z.string(),
  /** Stable batch identity: the X-LangWatch-Event-Id across every retry. */
  batchId: z.string(),
  envelopes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      created: z.string(),
      schema_version: z.literal("1"),
      data: z.record(z.unknown()),
    }),
  ),
});
export type SendBatchPayload = z.infer<typeof sendBatchSchema>;

export const flushEndpointSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  endpointId: z.string(),
  scheduledFor: z.number().int(),
});
export type FlushEndpointPayload = z.infer<typeof flushEndpointSchema>;

export interface WebhookDeliveryProcessDeps {
  processStore: ProcessStore;
  endpoints: WebhookEndpointService;
  /** Resolves the org's active plan for the enterprise gate. */
  getPlan: (organizationId: string) => Promise<PlanInfo>;
  now?: () => number;
}

const EMPTY_USAGE: SpendUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_tokens: 0,
};

/** The delivery view as a spend row, so the envelope mapper stays the one
 *  place the external contract is shaped. Rating happens here with the
 *  same deterministic service the fold uses, never by reading the fold's
 *  table: the two consumers of the log stay independent by contract. */
export function deliverPayloadToRow(payload: DeliverPayload): SpendEventRow {
  const usage = payload.usage ?? EMPTY_USAGE;
  const rated =
    payload.status === "settled"
      ? { costNanoUsd: 0, rateVersion: "" }
      : rateSpendNanoUsd({
          model: payload.model || payload.attribution?.model || "unknown",
          usage,
          rateVersion: payload.rate_version,
        });
  return {
    tenantId: payload.project_id,
    gatewayRequestId: payload.gateway_request_id,
    organizationId: payload.attribution?.organization_id ?? "",
    teamId: "",
    virtualKeyId: payload.attribution?.virtual_key_id ?? "",
    principalUserId: payload.attribution?.principal_user_id ?? "",
    endUserId: payload.attribution?.end_user_id ?? "",
    traceId: payload.attribution?.trace_id ?? "",
    model: payload.model || payload.attribution?.model || "",
    providerKey:
      payload.model_provider_id || payload.attribution?.model_provider_id || "",
    requestType: payload.attribution?.request_type ?? "",
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensCacheRead: usage.cache_read_input_tokens,
    tokensCacheWrite: usage.cache_creation_input_tokens,
    tokensReasoning: usage.reasoning_tokens,
    costNanoUsd: rated.costNanoUsd,
    costUsd: (rated.costNanoUsd / NANO_USD_PER_USD).toFixed(6),
    rateVersion: rated.rateVersion,
    status: payload.status,
    errorClass: payload.error?.type ?? "",
    httpStatus: payload.error?.http_status ?? 0,
    needsReconciliation: payload.status === "settled",
    settleReason: payload.settle_reason ?? "",
    labels: payload.attribution?.labels ?? [],
    metadata: payload.attribution?.metadata ?? "",
    durationMs: payload.duration_ms,
    occurredAt: new Date(payload.occurred_at),
  };
}

function batchIdFor(
  endpointId: string,
  envelopes: ReadonlyArray<{ id: string }>,
): string {
  const hash = createHash("sha256")
    .update(envelopes.map((e) => e.id).join(","))
    .digest("hex")
    .slice(0, 16);
  return `${endpointId}:${hash}`;
}

/**
 * The coalescing core shared by the deliver and flush executors: append an
 * envelope (when given) to the endpoint's buffered stream, then ship as
 * many full-or-due batches as the in-flight cap allows, in one atomic
 * commit of buffer state + outbox messages.
 *
 * Shipping policy, per the adopted delivery-controls design:
 * - a batch at max_batch_size ships immediately, delay never holds a full
 *   batch back;
 * - a partial batch ships once its oldest envelope has waited
 *   max_batch_delay_ms (zero means ship on arrival);
 * - nothing ships past max_in_flight pending sends, so a slow receiver
 *   accumulates buffer instead of parallel POSTs, and because full batches
 *   ship first the batch size CLIMBS toward its cap under backpressure,
 *   draining faster exactly when the receiver is behind.
 *
 * Redelivery safety: deliver appends carry an inbox sourceEventId (the
 * store absorbs duplicates), flushes are revision-guarded, and the batch
 * message key is a content hash, so any retry re-derives the same key and
 * the outbox suppresses it.
 */
async function flushEndpointStream({
  deps,
  organizationId,
  projectId,
  endpoint,
  append,
  sourceEventId,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  projectId: string;
  endpoint: WebhookEndpointView;
  append?: SendBatchPayload["envelopes"][number];
  sourceEventId?: string;
}): Promise<void> {
  const now = (deps.now ?? Date.now)();
  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId,
    processKey: `endpoint:${endpoint.id}`,
  };
  const existing = await deps.processStore.findByRef<EndpointStreamState>({
    ref,
  });
  const pending: PendingEnvelope[] = [
    ...(existing?.state.pending ?? []),
    ...(append ? [{ envelope: append, appendedAtMs: now }] : []),
  ];

  const outstanding = (
    await deps.processStore.findMessagesByRef({ ref })
  ).filter((m) => m.intentType === "sendBatch" && m.status === "pending")
    .length;

  const messages: NewOutboxMessage[] = [];
  let inFlight = outstanding;
  const remaining = [...pending];
  const dueAt = (entry: PendingEnvelope) =>
    entry.appendedAtMs + endpoint.maxBatchDelayMs;
  while (
    remaining.length > 0 &&
    inFlight < endpoint.maxInFlight &&
    (remaining.length >= endpoint.maxBatchSize ||
      endpoint.maxBatchDelayMs === 0 ||
      dueAt(remaining[0]!) <= now)
  ) {
    const batch = remaining
      .splice(0, endpoint.maxBatchSize)
      .map((e) => e.envelope);
    const batchId = batchIdFor(endpoint.id, batch);
    messages.push({
      messageKey: `send:${batchId}`,
      intentType: "sendBatch",
      // Envelope data is JSON by construction (spendRowToEnvelope emits
      // only JSON primitives); the cast crosses the JsonValue boundary.
      payload: {
        organizationId,
        projectId,
        endpointId: endpoint.id,
        batchId,
        envelopes: batch,
      } as unknown as JsonValue,
      traceCarrier: {},
    });
    inFlight++;
  }

  // Anything still buffered arms a wake: the coalescing deadline when the
  // delay is holding it, a short recheck when the in-flight cap is.
  const nextWakeAt =
    remaining.length === 0
      ? null
      : inFlight >= endpoint.maxInFlight
        ? now + WEBHOOK_FLUSH_RECHECK_MS
        : Math.max(dueAt(remaining[0]!), now + WEBHOOK_FLUSH_RECHECK_MS);

  const result = await deps.processStore.commit<EndpointStreamState>({
    ref,
    tenantId: projectId,
    sourceEventId: sourceEventId ?? null,
    expectedRevision: existing?.revision ?? 0,
    state: { pending: remaining },
    nextWakeAt,
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

/**
 * Level 1: resolve the org's ACTIVE endpoints subscribed to the event's
 * type and append the envelope to each endpoint's coalescing stream. The
 * append and any due batches commit atomically per endpoint.
 */
export function runDeliver(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: DeliverPayload,
    _context: IntentContext,
  ): Promise<void> => {
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

    const plan = await deps.getPlan(organizationId);
    if (plan.webhookEndpointsEnabled !== true) return;

    // Settled requests are their own event type: an endpoint subscribed
    // only to completed never receives one, and a family or match-all
    // subscription receives both.
    const eventType =
      payload.status === "settled"
        ? "gateway.request.settled"
        : "gateway.request.completed";
    const endpoints = (
      await deps.endpoints.getActiveByOrganization({ organizationId })
    ).filter((e) => eventMatches(e.enabledEvents, eventType));
    if (endpoints.length === 0) return;

    const row = deliverPayloadToRow(payload);
    const envelope = spendRowToEnvelope(
      row,
    ) as SendBatchPayload["envelopes"][number];

    for (const endpoint of endpoints) {
      await flushEndpointStream({
        deps,
        organizationId,
        projectId: payload.project_id,
        endpoint,
        append: envelope,
        sourceEventId: `deliver:${endpoint.id}:${payload.gateway_request_id}:${payload.status}`,
      });
    }

    await runMaintenanceIfDue(deps, payload.project_id);
  };
}

/**
 * The wake-armed half of coalescing: ship whatever became due (delay
 * elapsed or in-flight freed) for one endpoint's stream.
 */
export function runFlushEndpoint(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: FlushEndpointPayload,
    _context: IntentContext,
  ): Promise<void> => {
    const endpoint = await deps.endpoints.getDeliverable({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    });
    if (!endpoint) return;
    await flushEndpointStream({
      deps,
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      endpoint,
    });
  };
}

/**
 * Outbox and delivery-log retention, CAS-guarded on a singleton stream row
 * so exactly one pod runs each hourly sweep. The in-process throttle keeps
 * the hot deliver path from probing the row more than once a minute.
 */
async function runMaintenanceIfDue(
  deps: WebhookDeliveryProcessDeps,
  projectId: string,
): Promise<void> {
  const now = (deps.now ?? Date.now)();
  if (now - maintenanceLastCheckedMs < 60_000) return;
  maintenanceLastCheckedMs = now;

  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId,
    processKey: MAINTENANCE_PROCESS_KEY,
  };
  try {
    const existing = await deps.processStore.findByRef<{ lastRunMs: number }>(
      { ref },
    );
    if (existing && now - existing.state.lastRunMs < MAINTENANCE_INTERVAL_MS) {
      return;
    }
    const claimed = await deps.processStore.commit({
      ref,
      tenantId: projectId,
      sourceEventId: null,
      expectedRevision: existing?.revision ?? 0,
      state: { lastRunMs: now },
      nextWakeAt: null,
      messages: [],
      now,
    });
    if (claimed.outcome !== "committed") return;

    await deps.processStore.deleteDispatchedBefore({
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      before: now - OUTBOX_ROW_RETENTION_MS,
    });
    await deps.endpoints.pruneDeliveries(new Date(now));
  } catch (error) {
    logger.warn({ error }, "webhook delivery maintenance sweep failed");
  }
}

/**
 * Level 2: deliver one frozen batch to one endpoint through the
 * SSRF-fenced signed sender, record the receiver's answer, and classify:
 * 2xx acks, 5xx/429/408 retry along the ladder (Retry-After honored as a
 * floor), other statuses retire the batch to the dead letter immediately.
 * The endpoint's failure streak and the 72h auto-disable ride every
 * recorded outcome.
 */
export function runWebhookSendBatch(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: SendBatchPayload,
    context: IntentContext,
  ): Promise<void> => {
    // The service's deliverable read owns the liveness predicate. A deleted
    // or disabled endpoint drains its queue without POSTing: the spend
    // record keeps the events, re-enable plus replay covers the gap.
    const endpoint = await deps.endpoints.getDeliverable({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    });
    if (!endpoint) {
      logger.info(
        { endpointId: payload.endpointId, batchId: payload.batchId },
        "webhook batch dropped: endpoint disabled or gone (replay covers the gap)",
      );
      return;
    }

    const secret = await deps.endpoints.getSigningSecret({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    });
    const body = JSON.stringify({ batch: payload.envelopes });
    const startedAt = (deps.now ?? Date.now)();

    let status: number | undefined;
    let responseBody = "";
    let retryAfterMs: number | undefined;
    try {
      const result = await sendWebhook({
        url: endpoint.url,
        body,
        triggerName: payload.endpointId,
        contextLabel: `Webhook endpoint ${payload.endpointId}`,
        projectId: payload.projectId,
        eventId: payload.batchId,
        signingSecret: secret,
        attempt: context.attempt,
      });
      status = result.status;
      responseBody = result.body;
      retryAfterMs = result.retryAfterMs;
    } catch (error) {
      // Transport-level failure (DNS, SSRF block, timeout): no receiver
      // status to store. DispatchError carries the retryable classification
      // the dispatcher acts on.
      const retryable =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "retryable") !== false
          : true;
      await deps.endpoints.recordDeliveryAttempt({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        dispatchId: payload.batchId,
        attempt: context.attempt,
        eventCount: payload.envelopes.length,
        outcome: retryable ? "retryable" : "terminal",
        latencyMs: (deps.now ?? Date.now)() - startedAt,
        error:
          error instanceof Error ? error.message.slice(0, 500) : String(error),
      });
      throw error;
    }

    const latencyMs = (deps.now ?? Date.now)() - startedAt;
    if (status >= 200 && status < 300) {
      await deps.endpoints.recordDeliveryAttempt({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        dispatchId: payload.batchId,
        attempt: context.attempt,
        eventCount: payload.envelopes.length,
        outcome: "success",
        responseStatus: status,
        latencyMs,
      });
      return;
    }

    const retryable = status >= 500 || status === 429 || status === 408;
    await deps.endpoints.recordDeliveryAttempt({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
      dispatchId: payload.batchId,
      attempt: context.attempt,
      eventCount: payload.envelopes.length,
      outcome: retryable ? "retryable" : "terminal",
      responseStatus: status,
      latencyMs,
      error: `HTTP ${status}`,
      response: {
        body: responseBody.slice(0, 1000),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      },
    });
    // Throws DispatchError with the same classification just recorded; the
    // dispatcher ladders retryables and dead-letters terminals immediately.
    assertWebhookDelivered({
      result: { status, body: responseBody, retryAfterMs },
      triggerName: payload.endpointId,
    });
  };
}

function attributionFrom(data: AdmitSpendCommandData): SpendAttribution {
  return {
    organization_id: data.organization_id,
    virtual_key_id: data.virtual_key_id,
    principal_user_id: data.principal_user_id,
    end_user_id: data.end_user_id,
    model: data.model,
    model_provider_id: data.model_provider_id,
    trace_id: data.trace_id,
    request_type: data.request_type,
    labels: data.labels,
    metadata: data.metadata,
    admitted_at: data.occurred_at,
  };
}

/**
 * The staged applier mounted on the gateway-spend pipeline. The generated
 * subscriber keys instances by the aggregate id (the gateway request) and
 * the transactional inbox consumes each event exactly once.
 */
export function webhookDeliveryPM(
  deps: WebhookDeliveryProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  return (pm) =>
    pm
      .state<WebhookDeliveryState>(INITIAL_WEBHOOK_DELIVERY_STATE)
      .intent("deliver", deliverSchema, runDeliver(deps))
      .intent("flushEndpoint", flushEndpointSchema, runFlushEndpoint(deps))
      .intent("sendBatch", sendBatchSchema, runWebhookSendBatch(deps))
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data) => ({
        state: {
          ...state,
          attribution: attributionFrom(data as AdmitSpendCommandData),
        },
      }))
      .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, ctx) => {
        const confirmed = data as ConfirmSpendCommandData;
        return {
          state,
          intents: [
            ctx.intents.deliver("deliver:confirmed", {
              gateway_request_id: confirmed.gateway_request_id,
              project_id: ctx.projectId,
              status: "confirmed",
              occurred_at: confirmed.occurred_at,
              attribution: state.attribution,
              model: confirmed.model,
              model_provider_id: confirmed.model_provider_id,
              usage: confirmed.usage,
              rate_version: confirmed.rate_version,
              duration_ms: confirmed.duration_ms,
              error: null,
              settle_reason: null,
            }),
          ],
        };
      })
      .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, ctx) => {
        const failed = data as FailSpendCommandData;
        return {
          state,
          intents: [
            ctx.intents.deliver("deliver:failed", {
              gateway_request_id: failed.gateway_request_id,
              project_id: ctx.projectId,
              status: "failed",
              occurred_at: failed.occurred_at,
              attribution: state.attribution,
              model: failed.model,
              model_provider_id: failed.model_provider_id,
              usage: failed.usage,
              rate_version: "",
              duration_ms: failed.duration_ms,
              error: failed.error,
              settle_reason: null,
            }),
          ],
        };
      })
      .on(GATEWAY_SPEND_SETTLED_EVENT_TYPE, (state, data, ctx) => {
        const settled = data as SettleSpendCommandData;
        return {
          state,
          intents: [
            ctx.intents.deliver("deliver:settled", {
              gateway_request_id: settled.gateway_request_id,
              project_id: ctx.projectId,
              status: "settled",
              occurred_at: settled.occurred_at,
              attribution: state.attribution,
              model: "",
              model_provider_id: "",
              usage: null,
              rate_version: "",
              duration_ms: 0,
              error: null,
              settle_reason: settled.reason,
            }),
          ],
        };
      })
      // Endpoint streams arm wakes for their coalescing deadlines; the
      // wake hands the flush to the I/O executor. Per-request instances
      // never arm wakes, and unknown keys stand down harmlessly.
      .onWake((state, ctx) => {
        if (!isEndpointStreamKey(ctx.key)) return { state };
        const stream = state as unknown as EndpointStreamState;
        const endpointId = ctx.key.slice("endpoint:".length);
        const organizationId =
          stream.pending[0]?.envelope.data?.organization_id;
        if (typeof organizationId !== "string" || organizationId === "") {
          return { state };
        }
        return {
          state,
          intents: [
            ctx.intents.flushEndpoint(`flush:${ctx.at}`, {
              organizationId,
              projectId: ctx.projectId,
              endpointId,
              scheduledFor: ctx.at,
            }),
          ],
        };
      })
      // Spend events carry ids, integer quantities, and the caller's own
      // metadata echo; no prompts or responses exist anywhere in this
      // pipeline, so the event data is safe to persist as the payload.
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox({
        maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
        retryDelayMs: webhookRetryDelayMs,
        // Sends are slow (a receiver can burn the full 10s timeout) and
        // parallel-safe: batches are independent, and Stripe-style
        // receivers must tolerate concurrent deliveries.
        concurrency: 4,
        batchSize: 8,
        leaseDurationMs: 120_000,
      });
}
