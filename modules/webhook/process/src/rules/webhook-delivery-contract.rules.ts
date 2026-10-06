// SPDX-License-Identifier: Apache-2.0

/**
 * The wire shapes and fixed quantities webhook delivery is defined by: the spend events it
 * consumes, the usage counters an envelope reports, the intent payload schemas, the per-request
 * and per-endpoint process state, and the retry ladder a failing endpoint climbs.
 */

import type { Event, IntentContext } from "@langwatch/eventing";
import {
  type GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  type GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  type GATEWAY_SPEND_FAILED_EVENT_TYPE,
  type GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";
import type { WebhookEndpointView } from "@langwatch/webhook-contract";
import { z } from "zod";

import type { WebhookDestinationConfig } from "../rules/webhook-destination.rules.ts";

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
  input_image_tokens: 0,
  output_image_tokens: 0,
  image_count: 0,
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

/** Deleted (gone) and disabled (paused, the receiver is expected back) are different promises. */
export type WebhookDeliveryDisposition =
  | { state: "deliverable"; endpoint: WebhookEndpointView }
  | { state: "paused" }
  | { state: "gone" };

export type WebhookDispatchResult = {
  verdict: "success" | "retryable" | "terminal";
  status: number | null;
  error?: string;
  body?: unknown;
  retryAfterMs?: number;
};

export interface WebhookDeliveryEndpointService {
  findActiveByOrganization(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  findDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null>;
  getDeliveryDisposition(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDeliveryDisposition>;
  findSigningSecrets(input: { organizationId: string; endpointId: string }): Promise<string[]>;
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
  pruneDeliveries(now?: Instant): Promise<number>;
}

export const WEBHOOK_DELIVERY_PROCESS_NAME = "webhookDelivery" as const;
/** Main's governance delivery process: its instance, inbox and outbox rows keep this name. */
export const GOVERNANCE_EVENTS_PROCESS_NAME = "governanceEventsDelivery" as const;

/**
 * The Stripe-shaped retry ladder, holding at 4h: 11 attempts keep the last retry inside a day even
 * at full +20% jitter (1m + 5m + 15m + 30m + 1h + 2h + 4h + 3 * 4h = 19h51m). Past that a batch
 * parks as dead, kept until it delivers or an operator discards it.
 */
export const WEBHOOK_RETRY_LADDER_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
];
export const WEBHOOK_SEND_MAX_ATTEMPTS = 11;

/** How soon a stream capped on in-flight rechecks, and the floor for a
 *  delay-armed wake. Batching never waits longer than the endpoint's own
 *  max_batch_delay_ms; this only bounds the retry cadence while capped. */
/** Dispatched outbox rows older than this are pruned by maintenance. */
export const OUTBOX_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Maintenance cadence: the winner of the hourly CAS runs the sweeps. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
export const MAINTENANCE_PROCESS_KEY = "maintenance";
export const MAINTENANCE_TENANT = "__webhook_maintenance__";

/** Attribution captured at admission; outcome events carry only the
 *  outcome. Field names mirror the admit command's wire shape. */
const spendAttributionSchema = z.object({
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
});
export type SpendAttribution = z.infer<typeof spendAttributionSchema>;

/** What the process instance contributes to every deliver payload: the
 *  project it runs in and the attribution admission stored. */
export interface DeliverInstance {
  projectId: string;
  attribution: SpendAttribution | null;
}

export const INITIAL_WEBHOOK_DELIVERY_STATE: WebhookDeliveryState = {
  attribution: null,
  pendingOutcome: null,
};

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
  input_image_tokens: z.number().int().min(0).default(0),
  output_image_tokens: z.number().int().min(0).default(0),
  image_count: z.number().int().min(0).default(0),
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

export const webhookDeliveryStateSchema = z.object({
  attribution: spendAttributionSchema.nullable(),
  /** An outcome this instance saw before its admission. Outcomes can
   *  outrun their admit append (the fold's status lattice is built for the
   *  same ordering), and the envelope needs attribution, so the outcome
   *  waits here until `admitted` arrives and emits it. */
  pendingOutcome: deliverSchema.nullable(),
});
export type WebhookDeliveryState = z.infer<typeof webhookDeliveryStateSchema>;
export type DeliverPayload = z.infer<typeof deliverSchema>;

const bufferedEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.literal("1"),
  data: z.record(z.string(), z.unknown()),
});

export const sendBatchSchema = z.object({
  organizationId: z.string(),
  endpointId: z.string(),
  /** Stable batch identity: the X-LangWatch-Delivery-Id across every retry. */
  batchId: z.string(),
  envelopes: z.array(bufferedEnvelopeSchema),
});
export type SendBatchPayload = z.infer<typeof sendBatchSchema>;

/**
 * The per-endpoint stream instance (processKey `endpoint:<id>`): the coalescing buffer the
 * deliver and flush executors commit directly. `salt` marks a replayed entry.
 */
const endpointStreamStateSchema = z.object({
  pending: z.array(
    z.object({
      envelope: bufferedEnvelopeSchema,
      appendedAtMs: z.number(),
      salt: z.string().optional(),
    }),
  ),
});
export type EndpointStreamState = z.infer<typeof endpointStreamStateSchema>;

/** The hourly retention claim (processKey `maintenance`): a compare-and-set row no handler folds. */
const maintenanceClaimStateSchema = z.object({ lastRunMs: z.number() });
export type MaintenanceClaimState = z.infer<typeof maintenanceClaimStateSchema>;

/** One process name keeps three instance kinds: a request's delivery, an endpoint's stream, the claim. */
export const webhookProcessStateSchema = z.union([
  webhookDeliveryStateSchema,
  endpointStreamStateSchema,
  maintenanceClaimStateSchema,
]);
export type WebhookProcessState = z.infer<typeof webhookProcessStateSchema>;

export const flushEndpointSchema = z.object({
  organizationId: z.string(),
  endpointId: z.string(),
  scheduledFor: z.number().int(),
});
export type FlushEndpointPayload = z.infer<typeof flushEndpointSchema>;

/**
 * What the process runtime invokes for one intent. Named so the service can
 * declare what it hands back instead of deferring to `ReturnType<typeof ...>`,
 * which told a reader nothing and hid the payload each executor accepts.
 */
export type IntentExecutor<Payload> = (payload: Payload, context: IntentContext) => Promise<void>;
