// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  FailSpendCommandData,
  SettleSpendCommandData,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import type { GatewaySpendProcessingEvent } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/events";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type {
  NewOutboxMessage,
  ProcessStore,
} from "~/server/event-sourcing/process-manager/stores/processStore.types";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";
import { nanoUsdToDecimalString } from "~/server/gateway/wireMoney";
import { pruneExpiredIdempotencyReceipts } from "~/server/webhooks/deliveryLog";
import {
  assertWebhookDelivered,
  sendWebhook,
  WEBHOOK_DELIVERY_ID_HEADER,
  type WebhookSendResult,
} from "~/server/webhooks/sendWebhook";
import { allowsInsecureLocalUrls } from "~/server/webhooks/urlPolicy";
import type { PlanInfo } from "../../licensing/planInfo";
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
const MAINTENANCE_TENANT = "__webhook_maintenance__";
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
  /** An outcome this instance saw before its admission. Outcomes can
   *  outrun their admit append (the fold's status lattice is built for the
   *  same ordering), and the envelope needs attribution, so the outcome
   *  waits here until `admitted` arrives and emits it. */
  pendingOutcome: DeliverPayload | null;
}

export const INITIAL_WEBHOOK_DELIVERY_STATE: WebhookDeliveryState = {
  attribution: null,
  pendingOutcome: null,
};

/** A buffered envelope with its arrival instant, for the coalescing
 *  deadline and the lag (oldest-undelivered) metric. `salt` is set only
 *  on REPLAYED entries: the batch id hashes it in so a replay of
 *  already-delivered envelopes cannot collide with the historical
 *  batch's message key and silently no-op. */
export interface PendingEnvelope {
  envelope: SendBatchPayload["envelopes"][number];
  appendedAtMs: number;
  salt?: string;
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

/** Every quantity added after the first deploy carries a default: this rides
 *  a durable outbox row, so a payload the previous build wrote is read back
 *  by this one, and a field without a default turns that row into a
 *  permanent parse failure instead of a delivery. */
const spendUsagePayloadSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_input_tokens: z.number().int().min(0),
  cache_creation_input_tokens: z.number().int().min(0),
  cache_creation_1h_tokens: z.number().int().min(0).default(0),
  reasoning_tokens: z.number().int().min(0),
  input_audio_tokens: z.number().int().min(0).default(0),
  output_audio_tokens: z.number().int().min(0).default(0),
  input_chars: z.number().int().min(0).default(0),
  audio_ms: z.number().int().min(0).default(0),
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
  /** The price the outcome event carried, in integer nano-USD. A
   *  settlement priced nothing, so it carries zero. */
  cost_nano_usd: z.number().int().min(0),
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
  endpointId: z.string(),
  /** Stable batch identity: the X-LangWatch-Delivery-Id across every retry. */
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
  endpointId: z.string(),
  scheduledFor: z.number().int(),
});
export type FlushEndpointPayload = z.infer<typeof flushEndpointSchema>;

export interface WebhookDeliveryProcessDeps {
  processStore: ProcessStore;
  endpoints: WebhookEndpointService;
  /** Install-wide maintenance runs off this PM's hourly sweep and reaches
   *  past the endpoint tables (the idempotency receipt expiry), so it needs a
   *  handle rather than going through the endpoint service. */
  prisma: PrismaClient;
  /** Resolves the org's active plan for the enterprise gate. */
  getPlan: (organizationId: string) => Promise<PlanInfo>;
  now?: () => number;
}

/** The columns admission's attribution owns. A row whose process instance
 *  never saw an `admitted` event still needs every one of them, so each
 *  falls back to the empty value the spend log stores. */
function attributedColumns(
  attribution: DeliverPayload["attribution"],
): Pick<
  SpendEventRow,
  | "organizationId"
  | "virtualKeyId"
  | "principalUserId"
  | "endUserId"
  | "traceId"
  | "requestType"
  | "labels"
  | "metadata"
> {
  return {
    organizationId: attribution?.organization_id ?? "",
    virtualKeyId: attribution?.virtual_key_id ?? "",
    principalUserId: attribution?.principal_user_id ?? "",
    endUserId: attribution?.end_user_id ?? "",
    traceId: attribution?.trace_id ?? "",
    requestType: attribution?.request_type ?? "",
    labels: attribution?.labels ?? [],
    metadata: attribution?.metadata ?? "",
  };
}

/** The RESOLVED model identity when the outcome carried one, else the
 *  identity admission requested. `fallback` is what a request that named
 *  neither stores. */
function resolvedModel(payload: DeliverPayload, fallback: string): string {
  return payload.model || payload.attribution?.model || fallback;
}

/** The delivery view as a spend row, so the envelope mapper stays the one
 *  place the external contract is shaped. The price is the one the outcome
 *  event carried, never a fresh rating and never a read of the fold's
 *  table: the log's consumers stay independent AND state the same cost. */
export function deliverPayloadToRow(payload: DeliverPayload): SpendEventRow {
  const usage = payload.usage ?? EMPTY_SPEND_USAGE;
  return {
    ...attributedColumns(payload.attribution),
    tenantId: payload.project_id,
    gatewayRequestId: payload.gateway_request_id,
    teamId: "",
    model: resolvedModel(payload, ""),
    providerKey:
      payload.model_provider_id || payload.attribution?.model_provider_id || "",
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensCacheRead: usage.cache_read_input_tokens,
    tokensCacheWrite: usage.cache_creation_input_tokens,
    tokensReasoning: usage.reasoning_tokens,
    costNanoUsd: payload.cost_nano_usd,
    costUsd: nanoUsdToDecimalString(payload.cost_nano_usd),
    rateVersion: payload.rate_version,
    status: payload.status,
    errorClass: payload.error?.type ?? "",
    httpStatus: payload.error?.http_status ?? 0,
    needsReconciliation: payload.status === "settled",
    settleReason: payload.settle_reason ?? "",
    durationMs: payload.duration_ms,
    occurredAt: new Date(payload.occurred_at),
  };
}

function batchIdFor(
  endpointId: string,
  entries: ReadonlyArray<{ envelope: { id: string }; salt?: string }>,
): string {
  const hash = createHash("sha256")
    .update(
      entries
        .map((e) => (e.salt ? `${e.envelope.id}:${e.salt}` : e.envelope.id))
        .join(","),
    )
    .digest("hex")
    .slice(0, 16);
  return `${endpointId}:${hash}`;
}

/** The instant a buffered envelope stops being held by the coalescing
 *  delay. */
function coalescingDeadline(
  entry: PendingEnvelope,
  endpoint: WebhookEndpointView,
): number {
  return entry.appendedAtMs + endpoint.maxBatchDelayMs;
}

/**
 * Split the stream's buffer into the batches shippable right now and what
 * stays buffered, per the adopted delivery-controls design:
 * - a batch at max_batch_size ships immediately, delay never holds a full
 *   batch back;
 * - a partial batch ships once its oldest envelope has waited
 *   max_batch_delay_ms (zero means ship on arrival);
 * - nothing ships past max_in_flight pending sends, so a slow receiver
 *   accumulates buffer instead of parallel POSTs, and because full batches
 *   ship first the batch size CLIMBS toward its cap under backpressure,
 *   draining faster exactly when the receiver is behind.
 */
function planEndpointBatches({
  organizationId,
  endpoint,
  pending,
  outstanding,
  now,
}: {
  organizationId: string;
  endpoint: WebhookEndpointView;
  pending: readonly PendingEnvelope[];
  outstanding: number;
  now: number;
}): {
  messages: NewOutboxMessage[];
  remaining: PendingEnvelope[];
  inFlight: number;
} {
  const messages: NewOutboxMessage[] = [];
  const remaining = [...pending];
  let inFlight = outstanding;
  while (
    remaining.length > 0 &&
    inFlight < endpoint.maxInFlight &&
    (remaining.length >= endpoint.maxBatchSize ||
      endpoint.maxBatchDelayMs === 0 ||
      coalescingDeadline(remaining[0]!, endpoint) <= now)
  ) {
    const batchEntries = remaining.splice(0, endpoint.maxBatchSize);
    const batch = batchEntries.map((e) => e.envelope);
    const batchId = batchIdFor(endpoint.id, batchEntries);
    messages.push({
      messageKey: `send:${batchId}`,
      intentType: "sendBatch",
      // Envelope data is JSON by construction (spendRowToEnvelope emits
      // only JSON primitives); the cast crosses the JsonValue boundary.
      payload: {
        organizationId,
        endpointId: endpoint.id,
        batchId,
        envelopes: batch,
      } as unknown as JsonValue,
      traceCarrier: {},
    });
    inFlight++;
  }
  return { messages, remaining, inFlight };
}

/** Anything still buffered arms a wake: the coalescing deadline when the
 *  delay is holding it, a short recheck when the in-flight cap is. */
function nextStreamWakeAt({
  endpoint,
  remaining,
  inFlight,
  now,
}: {
  endpoint: WebhookEndpointView;
  remaining: readonly PendingEnvelope[];
  inFlight: number;
  now: number;
}): number | null {
  const oldest = remaining[0];
  if (!oldest) return null;
  if (inFlight >= endpoint.maxInFlight) return now + WEBHOOK_FLUSH_RECHECK_MS;
  return Math.max(
    coalescingDeadline(oldest, endpoint),
    now + WEBHOOK_FLUSH_RECHECK_MS,
  );
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
async function flushEndpointStream({
  deps,
  organizationId,
  endpoint,
  append,
  appendSalt,
  sourceEventId,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  endpoint: WebhookEndpointView;
  append?: SendBatchPayload["envelopes"][number];
  appendSalt?: string;
  sourceEventId?: string;
}): Promise<void> {
  const now = (deps.now ?? Date.now)();
  // Endpoints belong to the ORGANIZATION, so the stream does too: one row
  // per endpoint holds one buffer, one outstanding-send count, and
  // therefore one max_in_flight, no matter how many of the org's projects
  // feed it. Keying by project would give an endpoint N of each.
  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: organizationId,
    processKey: `endpoint:${endpoint.id}`,
  };
  const existing = await deps.processStore.findByRef<EndpointStreamState>({
    ref,
  });
  const pending: PendingEnvelope[] = [
    ...(existing?.state.pending ?? []),
    ...(append
      ? [
          {
            envelope: append,
            appendedAtMs: now,
            ...(appendSalt ? { salt: appendSalt } : {}),
          },
        ]
      : []),
  ];

  const outstanding = (
    await deps.processStore.findMessagesByRef({ ref })
  ).filter(
    (m) => m.intentType === "sendBatch" && m.status === "pending",
  ).length;

  const { messages, remaining, inFlight } = planEndpointBatches({
    organizationId,
    endpoint,
    pending,
    outstanding,
    now,
  });

  const result = await deps.processStore.commit<EndpointStreamState>({
    ref,
    tenantId: organizationId,
    sourceEventId: sourceEventId ?? null,
    expectedRevision: existing?.revision ?? 0,
    state: { pending: remaining },
    nextWakeAt: nextStreamWakeAt({ endpoint, remaining, inFlight, now }),
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

/** Settled requests are their own event type: an endpoint subscribed only
 *  to completed never receives one, and a family or match-all subscription
 *  receives both. */
function deliveryEventType(status: DeliverPayload["status"]): string {
  return status === "settled"
    ? "gateway.request.settled"
    : "gateway.request.completed";
}

/** The org's ACTIVE endpoints whose subscription covers this outcome. */
async function endpointsSubscribedTo({
  deps,
  organizationId,
  status,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  status: DeliverPayload["status"];
}): Promise<WebhookEndpointView[]> {
  const eventType = deliveryEventType(status);
  return (
    await deps.endpoints.getActiveByOrganization({ organizationId })
  ).filter((e) => eventMatches(e.enabledEvents, eventType));
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

    const endpoints = await endpointsSubscribedTo({
      deps,
      organizationId,
      status: payload.status,
    });
    if (endpoints.length === 0) return;

    const row = deliverPayloadToRow(payload);
    const envelope = spendRowToEnvelope(
      row,
    ) as SendBatchPayload["envelopes"][number];

    for (const endpoint of endpoints) {
      await flushEndpointStream({
        deps,
        organizationId,
        endpoint,
        append: envelope,
        sourceEventId: `deliver:${endpoint.id}:${payload.gateway_request_id}:${payload.status}`,
      });
    }

    await runMaintenanceIfDue(deps);
  };
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
export async function appendReplayToEndpointStream({
  deps,
  organizationId,
  endpoint,
  envelope,
  replayId,
}: {
  deps: WebhookDeliveryProcessDeps;
  organizationId: string;
  endpoint: WebhookEndpointView;
  envelope: SendBatchPayload["envelopes"][number];
  replayId: string;
}): Promise<void> {
  await flushEndpointStream({
    deps,
    organizationId,
    endpoint,
    append: envelope,
    appendSalt: replayId,
    sourceEventId: `replay:${replayId}:${endpoint.id}:${envelope.id}`,
  });
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
): Promise<void> {
  const now = (deps.now ?? Date.now)();
  if (now - maintenanceLastCheckedMs < 60_000) return;
  maintenanceLastCheckedMs = now;

  // Both sweeps below are global, so the CAS row must be too: a sentinel
  // tenant keeps it one row total, not one per project, and exactly one
  // pod per hour runs the sweeps across the whole install.
  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: MAINTENANCE_TENANT,
    processKey: MAINTENANCE_PROCESS_KEY,
  };
  try {
    const existing = await deps.processStore.findByRef<{ lastRunMs: number }>({
      ref,
    });
    if (existing && now - existing.state.lastRunMs < MAINTENANCE_INTERVAL_MS) {
      return;
    }
    const claimed = await deps.processStore.commit({
      ref,
      tenantId: MAINTENANCE_TENANT,
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
    // Receipts expire lazily, when their key is next presented, so a key that
    // is never retried is never revisited and its row never leaves. The
    // expiresAt index was built for a bulk sweep; this is it.
    await pruneExpiredIdempotencyReceipts({
      prisma: deps.prisma,
      now: new Date(now),
    });
  } catch (error) {
    logger.warn({ error }, "webhook delivery maintenance sweep failed");
  }
}

/**
 * POST one frozen batch through the SSRF-fenced signed sender.
 *
 * A transport-level failure (DNS, SSRF block, timeout) leaves no receiver
 * status to store, so the attempt is recorded here and the error rethrown:
 * DispatchError carries the retryable classification the dispatcher acts
 * on.
 */
async function postWebhookBatch({
  deps,
  payload,
  context,
  endpoint,
  startedAt,
}: {
  deps: WebhookDeliveryProcessDeps;
  payload: SendBatchPayload;
  context: IntentContext;
  endpoint: WebhookEndpointView;
  startedAt: number;
}): Promise<WebhookSendResult> {
  const secrets = await deps.endpoints.getSigningSecrets({
    organizationId: payload.organizationId,
    endpointId: payload.endpointId,
  });
  try {
    return await sendWebhook({
      url: endpoint.url,
      body: JSON.stringify({ batch: payload.envelopes }),
      triggerName: payload.endpointId,
      contextLabel: `Webhook endpoint ${payload.endpointId}`,
      // Endpoints are organization-scoped, so their dispatch cap buckets
      // per organization rather than per project.
      projectId: payload.organizationId,
      eventId: payload.batchId,
      dispatchIdHeader: WEBHOOK_DELIVERY_ID_HEADER,
      signingSecrets: secrets,
      attempt: context.attempt,
      allowInsecureLocal: allowsInsecureLocalUrls(),
    });
  } catch (error) {
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
}

/**
 * Record the receiver's answer and classify it: 2xx acks, 5xx/429/408
 * retry along the ladder (Retry-After honored as a floor), other statuses
 * retire the batch to the dead letter immediately. The endpoint's failure
 * streak and the 72h auto-disable ride every recorded outcome.
 */
async function recordWebhookBatchOutcome({
  deps,
  payload,
  context,
  result,
  latencyMs,
}: {
  deps: WebhookDeliveryProcessDeps;
  payload: SendBatchPayload;
  context: IntentContext;
  result: WebhookSendResult;
  latencyMs: number;
}): Promise<void> {
  const attempt = {
    organizationId: payload.organizationId,
    endpointId: payload.endpointId,
    dispatchId: payload.batchId,
    attempt: context.attempt,
    eventCount: payload.envelopes.length,
    responseStatus: result.status,
    latencyMs,
  };
  if (result.status >= 200 && result.status < 300) {
    await deps.endpoints.recordDeliveryAttempt({
      ...attempt,
      outcome: "success",
    });
    return;
  }

  const retryable =
    result.status >= 500 || result.status === 429 || result.status === 408;
  await deps.endpoints.recordDeliveryAttempt({
    ...attempt,
    outcome: retryable ? "retryable" : "terminal",
    error: `HTTP ${result.status}`,
    response: {
      body: result.body.slice(0, 1000),
      ...(result.retryAfterMs !== undefined
        ? { retryAfterMs: result.retryAfterMs }
        : {}),
    },
  });
  // Throws DispatchError with the same classification just recorded; the
  // dispatcher ladders retryables and dead-letters terminals immediately.
  assertWebhookDelivered({
    result,
    triggerName: payload.endpointId,
  });
}

/**
 * Level 2: deliver one frozen batch to one endpoint through the
 * SSRF-fenced signed sender and record what the receiver answered.
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

    const startedAt = (deps.now ?? Date.now)();
    const result = await postWebhookBatch({
      deps,
      payload,
      context,
      endpoint,
      startedAt,
    });
    await recordWebhookBatchOutcome({
      deps,
      payload,
      context,
      result,
      latencyMs: (deps.now ?? Date.now)() - startedAt,
    });
  };
}

const WEBHOOK_DELIVERY_OUTBOX = {
  maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
  retryDelayMs: webhookRetryDelayMs,
  // Sends are slow (a receiver can burn the full 10s timeout) and
  // parallel-safe: batches are independent, and Stripe-style receivers
  // must tolerate concurrent deliveries.
  concurrency: 4,
  batchSize: 8,
  leaseDurationMs: 120_000,
};

/** The endpoint whose stream this wake belongs to, or null when the key is
 *  a per-request instance (they never arm wakes) or the buffer no longer
 *  names an organization to flush for. */
function endpointFlushTarget(
  state: WebhookDeliveryState,
  key: string,
): { endpointId: string; organizationId: string } | null {
  if (!isEndpointStreamKey(key)) return null;
  const stream = state as unknown as EndpointStreamState;
  const organizationId = stream.pending[0]?.envelope.data?.organization_id;
  if (typeof organizationId !== "string" || organizationId === "") return null;
  return { endpointId: key.slice("endpoint:".length), organizationId };
}

/** What the process instance contributes to every deliver payload: the
 *  project it runs in and the attribution admission stored. */
interface DeliverInstance {
  projectId: string;
  attribution: SpendAttribution | null;
}

/** Every outcome fills the same deliver payload. Fields an outcome does
 *  not carry stay at the log's empty values, so the envelope mapper never
 *  special-cases a missing one. */
function deliverPayloadFor(
  outcome: Pick<
    DeliverPayload,
    "status" | "gateway_request_id" | "occurred_at"
  > &
    Partial<DeliverPayload>,
  instance: DeliverInstance,
): DeliverPayload {
  return {
    project_id: instance.projectId,
    attribution: instance.attribution,
    model: "",
    model_provider_id: "",
    usage: null,
    cost_nano_usd: 0,
    rate_version: "",
    duration_ms: 0,
    error: null,
    settle_reason: null,
    ...outcome,
  };
}

/** A confirmed request carries the resolved model identity, the usage it
 *  billed, and the price with the rate version it was priced at. */
function confirmedDeliverPayload(
  confirmed: ConfirmSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "confirmed",
      gateway_request_id: confirmed.gateway_request_id,
      occurred_at: confirmed.occurred_at,
      model: confirmed.model,
      model_provider_id: confirmed.model_provider_id,
      usage: confirmed.usage,
      cost_nano_usd: confirmed.cost_nano_usd,
      rate_version: confirmed.rate_version,
      duration_ms: confirmed.duration_ms,
    },
    instance,
  );
}

/** A failed request carries whatever usage the provider reported before
 *  the error, priced the same way a confirmation is. */
function failedDeliverPayload(
  failed: FailSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "failed",
      gateway_request_id: failed.gateway_request_id,
      occurred_at: failed.occurred_at,
      model: failed.model,
      model_provider_id: failed.model_provider_id,
      usage: failed.usage,
      cost_nano_usd: failed.cost_nano_usd,
      rate_version: failed.rate_version,
      duration_ms: failed.duration_ms,
      error: failed.error,
    },
    instance,
  );
}

/** A settled request is a reservation released without an outcome: no
 *  model, no usage, and nothing priced, only why it settled. */
function settledDeliverPayload(
  settled: SettleSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "settled",
      gateway_request_id: settled.gateway_request_id,
      occurred_at: settled.occurred_at,
      settle_reason: settled.reason,
    },
    instance,
  );
}

/**
 * The state an outcome that outran its admission leaves behind. Precedence
 * mirrors the fold's status lattice: a real outcome (confirmed or failed)
 * always takes the slot, a settlement only fills an empty one, so the
 * envelope admission finally releases is the one the ledger agrees with.
 */
function withStashedOutcome(
  state: WebhookDeliveryState,
  incoming: DeliverPayload,
): WebhookDeliveryState {
  const keepStashed =
    incoming.status === "settled" && state.pendingOutcome !== null;
  return {
    ...state,
    pendingOutcome: keepStashed ? state.pendingOutcome : incoming,
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
      // Admission carries the attribution every envelope needs, so it also
      // releases whatever outcome arrived ahead of it. One admission per
      // instance (the log's idempotency key, then the inbox) means
      // `deliver:late` is minted at most once.
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, ctx) => {
        const attribution = attributionFrom(data as AdmitSpendCommandData);
        const stashed = state.pendingOutcome;
        const admitted = { ...state, attribution, pendingOutcome: null };
        if (!stashed) return { state: admitted };
        return {
          state: admitted,
          intents: [
            ctx.intents.deliver("deliver:late", { ...stashed, attribution }),
          ],
        };
      })
      .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, ctx) => {
        const payload = confirmedDeliverPayload(
          data as ConfirmSpendCommandData,
          { projectId: ctx.projectId, attribution: state.attribution },
        );
        if (state.attribution === null) {
          return { state: withStashedOutcome(state, payload) };
        }
        return {
          state,
          intents: [ctx.intents.deliver("deliver:confirmed", payload)],
        };
      })
      .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, ctx) => {
        const payload = failedDeliverPayload(data as FailSpendCommandData, {
          projectId: ctx.projectId,
          attribution: state.attribution,
        });
        if (state.attribution === null) {
          return { state: withStashedOutcome(state, payload) };
        }
        return {
          state,
          intents: [ctx.intents.deliver("deliver:failed", payload)],
        };
      })
      .on(GATEWAY_SPEND_SETTLED_EVENT_TYPE, (state, data, ctx) => {
        const payload = settledDeliverPayload(data as SettleSpendCommandData, {
          projectId: ctx.projectId,
          attribution: state.attribution,
        });
        if (state.attribution === null) {
          return { state: withStashedOutcome(state, payload) };
        }
        return {
          state,
          intents: [ctx.intents.deliver("deliver:settled", payload)],
        };
      })
      // Endpoint streams arm wakes for their coalescing deadlines; the
      // wake hands the flush to the I/O executor.
      .onWake((state, ctx) => {
        const target = endpointFlushTarget(state, ctx.key);
        if (!target) return { state };
        return {
          state,
          intents: [
            ctx.intents.flushEndpoint(`flush:${ctx.at}`, {
              ...target,
              scheduledFor: ctx.at,
            }),
          ],
        };
      })
      // Spend events carry ids, integer quantities, and the caller's own
      // metadata echo; no prompts or responses exist anywhere in this
      // pipeline, so the event data is safe to persist as the payload.
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox(WEBHOOK_DELIVERY_OUTBOX);
}
