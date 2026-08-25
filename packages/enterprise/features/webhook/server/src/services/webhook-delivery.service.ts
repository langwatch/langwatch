// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";
import type {
  Event,
  IntentContext,
  JsonValue,
  NewOutboxMessage,
  ProcessManagerApplier,
  ProcessIntent,
  ProcessStore,
} from "@langwatch/eventing";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import {
  eventMatches,
  type WebhookEndpointView,
} from "@langwatch/enterprise-webhook-contract";
import {
  WebhookEnvelopeService,
  type WebhookSpendEventRow,
} from "./webhook-envelope.service";
import type { WebhookDestinationConfig } from "./webhook-destination.service";

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE = "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE = "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE = "lw.gateway.spend.failed" as const;
export const GATEWAY_SPEND_SETTLED_EVENT_TYPE = "lw.gateway.spend.settled" as const;

export type SpendUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_1h_tokens: number;
  reasoning_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
  input_chars: number;
  audio_ms: number;
};

export const EMPTY_SPEND_USAGE: SpendUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation_1h_tokens: 0,
  reasoning_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
  input_chars: 0,
  audio_ms: 0,
};

type SpendAttributionData = {
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
};

type SpendOutcomeAttributionData = SpendAttributionData & {
  admitted_at: number;
};

export type AdmitSpendCommandData = SpendAttributionData & {
  gateway_request_id: string;
  occurred_at: number;
  tenantId: string;
  outcome_carries_attribution: boolean;
};

type SpendOutcomeData = SpendOutcomeAttributionData & {
  gateway_request_id: string;
  occurred_at: number;
  tenantId: string;
  usage: SpendUsage;
  cost_nano_usd: number;
  rate_version: string;
  duration_ms: number;
};

export type ConfirmSpendCommandData = SpendOutcomeData;
export type FailSpendCommandData = SpendOutcomeData & {
  error: { type: string; http_status: number };
};
export type SettleSpendCommandData = SpendOutcomeAttributionData & {
  gateway_request_id: string;
  occurred_at: number;
  tenantId: string;
  reason: string;
};

export type GatewaySpendProcessingEvent =
  | (Event<AdmitSpendCommandData> & { type: typeof GATEWAY_SPEND_ADMITTED_EVENT_TYPE })
  | (Event<ConfirmSpendCommandData> & { type: typeof GATEWAY_SPEND_CONFIRMED_EVENT_TYPE })
  | (Event<FailSpendCommandData> & { type: typeof GATEWAY_SPEND_FAILED_EVENT_TYPE })
  | (Event<SettleSpendCommandData> & { type: typeof GATEWAY_SPEND_SETTLED_EVENT_TYPE });

export type WebhookDispatchResult = {
  verdict: "success" | "retryable" | "terminal";
  status: number | null;
  error?: string;
  body?: unknown;
  retryAfterMs?: number;
};

export interface WebhookDeliveryEndpointService {
  getActiveByOrganization(input: {
    organizationId: string;
  }): Promise<WebhookEndpointView[]>;
  tryGetDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null>;
  getSigningSecrets(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<string[]>;
  getDestinationConfig(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDestinationConfig>;
  recordDeliveryAttempt(
    input: Record<string, unknown> & {
      organizationId: string;
      endpointId: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      outcome: "success" | "retryable" | "terminal";
    },
  ): Promise<void>;
  pruneDeliveries(now?: Date): Promise<number>;
}

function nanoUsdToDecimalString(value: number): string {
  const negative = value < 0;
  const absolute = BigInt(Math.abs(value));
  const whole = absolute / 1_000_000_000n;
  const fraction = (absolute % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

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

function webhookRetryDelayMs({ attempt }: { attempt: number }): number {
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

function isEndpointStreamKey(processKey: string): boolean {
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
  error: z.object({ type: z.string(), http_status: z.number().int() }).nullable(),
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
      data: z.record(z.string(), z.unknown()),
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
  endpoints: WebhookDeliveryEndpointService;
  pruneExpiredIdempotencyReceipts: (now: Date) => Promise<unknown>;
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

/** The columns admission's attribution owns. A row whose process instance
 *  never saw an `admitted` event still needs every one of them, so each
 *  falls back to the empty value the spend log stores. */
function attributedColumns(
  attribution: DeliverPayload["attribution"],
): Pick<
  WebhookSpendEventRow,
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
function deliverPayloadToRow(payload: DeliverPayload): WebhookSpendEventRow {
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
  return Math.max(coalescingDeadline(oldest, endpoint), now + WEBHOOK_FLUSH_RECHECK_MS);
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
  const pending: PendingEnvelope[] = existing?.state.pending
    ? [...existing.state.pending]
    : [];
  if (append) {
    const item: PendingEnvelope = { envelope: append, appendedAtMs: now };
    if (appendSalt) item.salt = appendSalt;
    pending.push(item);
  }

  const outstanding = (await deps.processStore.findMessagesByRef({ ref })).filter(
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
  return status === "settled" ? "gateway.request.settled" : "gateway.request.completed";
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
  const endpoints = await deps.endpoints.getActiveByOrganization({ organizationId });
  return endpoints.filter((e) => eventMatches(e.enabledEvents, eventType));
}

/**
 * Level 1: resolve the org's ACTIVE endpoints subscribed to the event's
 * type and append the envelope to each endpoint's coalescing stream. The
 * append and any due batches commit atomically per endpoint.
 */
function runDeliver(deps: WebhookDeliveryProcessDeps) {
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

    const plan = await deps.getPlan(organizationId);
    if (plan.webhookEndpointsEnabled !== true) return;

    const endpoints = await endpointsSubscribedTo({
      deps,
      organizationId,
      status: payload.status,
    });
    if (endpoints.length === 0) return;

    const row = deliverPayloadToRow(payload);
    const envelope = WebhookEnvelopeService.fromSpendRow(
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
async function appendReplayToEndpointStream({
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
function runFlushEndpoint(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: FlushEndpointPayload,
    _context: IntentContext,
  ): Promise<void> => {
    const endpoint = await deps.endpoints.tryGetDeliverable({
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
async function runMaintenanceIfDue(deps: WebhookDeliveryProcessDeps): Promise<void> {
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
    await deps.pruneExpiredIdempotencyReceipts(new Date(now));
  } catch (error) {
    logger.warn({ error }, "webhook delivery maintenance sweep failed");
  }
}

/**
 * Hand one frozen batch to the endpoint's transport.
 *
 * The transport answers with an ALREADY CLASSIFIED verdict, because the
 * classification depends on the transport: an HTTPS receiver answers with a
 * status code, a queue answers with a message id and no status at all. What
 * the two share is the bytes, which are built here, once, so both transports
 * put the same body on the wire and one signature verifier reads either.
 *
 * A transport-level failure (DNS, an SSRF block, a timeout) leaves nothing to
 * classify, so the attempt is recorded here and the error rethrown:
 * DispatchError carries the retryable flag the dispatcher acts on.
 */
async function dispatchWebhookBatch({
  deps,
  payload,
  context,
  startedAt,
}: {
  deps: WebhookDeliveryProcessDeps;
  payload: SendBatchPayload;
  context: IntentContext;
  startedAt: number;
}): Promise<WebhookDispatchResult> {
  // Two reads, run together: the secrets and the destination. The liveness
  // read above already has the row, but neither of these can be served from
  // it — both decrypt, and decryption is the service's to do, not this
  // executor's.
  const [secrets, destination] = await Promise.all([
    deps.endpoints.getSigningSecrets({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    }),
    deps.endpoints.getDestinationConfig({
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
    }),
  ]);
  try {
    return await deps.dispatch({
      destination,
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
      body: JSON.stringify({ batch: payload.envelopes }),
      batchId: payload.batchId,
      attempt: context.attempt,
      signingSecrets: secrets,
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
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    });
    throw error;
  }
}

/**
 * Record the transport's verdict and act on it: success acks, retryable
 * ladders (Retry-After honored as a floor), terminal retires the batch to
 * the dead letter immediately. The endpoint's failure streak and the 72h
 * auto-disable ride every recorded outcome.
 *
 * The verdict is the transport's, not re-derived here. A status code is only
 * one transport's way of expressing it, and a queue has none.
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
  result: WebhookDispatchResult;
  latencyMs: number;
}): Promise<void> {
  const attempt: {
    organizationId: string;
    endpointId: string;
    dispatchId: string;
    attempt: number;
    eventCount: number;
    responseStatus?: number;
    latencyMs: number;
  } = {
    organizationId: payload.organizationId,
    endpointId: payload.endpointId,
    dispatchId: payload.batchId,
    attempt: context.attempt,
    eventCount: payload.envelopes.length,
    latencyMs,
  };
  if (result.status !== null) attempt.responseStatus = result.status;
  if (result.verdict === "success") {
    await deps.endpoints.recordDeliveryAttempt({
      ...attempt,
      outcome: "success",
    });
    return;
  }

  // A transport may return a failure verdict with nothing to say. One reason
  // stands in for both the log row and the throw, so a delivery-log reader
  // never sees a failed attempt with a blank reason column.
  const reason = result.error ?? "delivery failed";
  const response: { body: unknown; retryAfterMs?: number } = {
    body: result.body,
  };
  if (result.retryAfterMs !== undefined) {
    response.retryAfterMs = result.retryAfterMs;
  }
  await deps.endpoints.recordDeliveryAttempt({
    ...attempt,
    outcome: result.verdict,
    error: reason,
    response,
  });
  // The same classification just recorded, as the throw the dispatcher acts
  // on: it ladders retryables and dead-letters terminals immediately.
  const dispatchError: {
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  } = {
    message: `Webhook endpoint ${payload.endpointId}: ${reason}`,
    retryable: result.verdict === "retryable",
  };
  // Honour the receiver's backpressure on a retryable verdict. The queue
  // folds it into its backoff as a floor.
  if (result.verdict === "retryable" && result.retryAfterMs !== undefined) {
    dispatchError.retryAfterMs = result.retryAfterMs;
  }
  throw new DispatchError(dispatchError);
}

/**
 * Level 2: deliver one frozen batch to one endpoint through whichever
 * transport it named, and record what came back.
 */
function runWebhookSendBatch(deps: WebhookDeliveryProcessDeps) {
  return async (payload: SendBatchPayload, context: IntentContext): Promise<void> => {
    // The service's deliverable read owns the liveness predicate. A deleted
    // or disabled endpoint drains its queue without delivering: the spend
    // record keeps the events, re-enable plus replay covers the gap.
    const endpoint = await deps.endpoints.tryGetDeliverable({
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
    const result = await dispatchWebhookBatch({
      deps,
      payload,
      context,
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
  outcome: Pick<DeliverPayload, "status" | "gateway_request_id" | "occurred_at"> &
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
  const keepStashed = incoming.status === "settled" && state.pendingOutcome !== null;
  return {
    ...state,
    pendingOutcome: keepStashed ? state.pendingOutcome : incoming,
  };
}

/**
 * The attribution an outcome states about itself, or null when it states
 * none.
 *
 * Every outcome carries it from the build that sets
 * `outcome_carries_attribution` on its admissions; an older build's outcomes
 * carry nothing and fall back to the admission this instance remembered.
 * The organization is the discriminator because delivery cannot resolve a
 * single endpoint without it.
 */
function attributionFromOutcome(
  data: ConfirmSpendCommandData | FailSpendCommandData | SettleSpendCommandData,
): SpendAttribution | null {
  if (!data.organization_id) return null;
  return {
    organization_id: data.organization_id,
    virtual_key_id: data.virtual_key_id,
    principal_user_id: data.principal_user_id,
    end_user_id: data.end_user_id,
    // Every outcome states a model identity. A confirmation or failure
    // states the one it RESOLVED; a settlement resolved none, so the
    // sweeper copies the identity admission requested off the spend record
    // — which is what a settled envelope has always named.
    model: data.model,
    model_provider_id: data.model_provider_id,
    trace_id: data.trace_id,
    request_type: data.request_type,
    labels: data.labels,
    metadata: data.metadata,
    admitted_at: data.admitted_at,
  };
}

/** What an outcome handler needs from the process context. */
interface DeliverOutcomeContext<Intent> {
  projectId: string;
  intents: { deliver: (key: string, payload: DeliverPayload) => Intent };
}

/**
 * One outcome, routed by what it can see. All three route identically, so
 * they share this rather than repeating it with a different payload builder.
 *
 * An outcome that states its own attribution freezes its deliver intent
 * immediately and leaves the state untouched, so the evolution is transient
 * and the request costs no durable row. One that does not falls back to the
 * admission this instance remembered: stashed until admission arrives,
 * released by it after.
 */
function onSpendOutcome<
  Intent,
  Data extends ConfirmSpendCommandData | FailSpendCommandData | SettleSpendCommandData,
>({
  state,
  ctx,
  status,
  data,
  toPayload,
}: {
  state: WebhookDeliveryState;
  ctx: DeliverOutcomeContext<Intent>;
  status: DeliverPayload["status"];
  data: Data;
  toPayload: (data: Data, instance: DeliverInstance) => DeliverPayload;
}): { state: WebhookDeliveryState; intents?: Intent[] } {
  const attribution = attributionFromOutcome(data) ?? state.attribution;
  const payload = toPayload(data, { projectId: ctx.projectId, attribution });
  if (attribution === null) {
    return { state: withStashedOutcome(state, payload) };
  }
  return {
    state,
    intents: [ctx.intents.deliver(`deliver:${status}`, payload)],
  };
}

/**
 * The admission: the one place a request's attribution is known.
 *
 * It releases an outcome that arrived ahead of it on BOTH paths, including
 * the one where it remembers nothing. A stash is not expected there — an
 * outcome only stashes when it carried no attribution, and admission and
 * outcome always come from the same pod and the same build — but the two
 * conditions are not the same one: an outcome stashes on its OWN empty
 * organization, not on the build that sent it. Where they disagree, dropping
 * the stash would cost the envelope and strand the instance row holding it,
 * since this handler is the only thing that could ever clear it.
 */
function onAdmission<Intent>({
  state,
  ctx,
  admit,
}: {
  state: WebhookDeliveryState;
  ctx: DeliverOutcomeContext<Intent>;
  admit: AdmitSpendCommandData;
}): { state: WebhookDeliveryState; intents?: Intent[] } {
  const attribution = attributionFrom(admit);
  const stashed = state.pendingOutcome;
  const release = stashed
    ? [ctx.intents.deliver("deliver:late", { ...stashed, attribution })]
    : void 0;

  // Every outcome states the attribution itself, so there is nothing worth
  // remembering and this admission writes no row.
  if (admit.outcome_carries_attribution) {
    if (!stashed) return { state };
    return { state: { ...state, pendingOutcome: null }, intents: release };
  }

  const admitted = { ...state, attribution, pendingOutcome: null };
  return stashed ? { state: admitted, intents: release } : { state: admitted };
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

export class WebhookDeliveryService {
  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {}

  static create(deps: WebhookDeliveryProcessDeps): WebhookDeliveryService {
    return new WebhookDeliveryService(deps);
  }

  static retryDelayMs(input: { attempt: number }): number {
    return webhookRetryDelayMs(input);
  }

  static isEndpointStreamKey(processKey: string): boolean {
    return isEndpointStreamKey(processKey);
  }

  static payloadToRow(payload: DeliverPayload): WebhookSpendEventRow {
    return deliverPayloadToRow(payload);
  }

  static async appendReplayToEndpointStream(
    input: Parameters<typeof appendReplayToEndpointStream>[0],
  ): Promise<void> {
    await appendReplayToEndpointStream(input);
  }

  runDeliver(): ReturnType<typeof runDeliver> {
    return runDeliver(this.deps);
  }

  runFlushEndpoint(): ReturnType<typeof runFlushEndpoint> {
    return runFlushEndpoint(this.deps);
  }

  runWebhookSendBatch(): ReturnType<typeof runWebhookSendBatch> {
    return runWebhookSendBatch(this.deps);
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
          if (!target) return { state };
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
        .transient();
  }
}
