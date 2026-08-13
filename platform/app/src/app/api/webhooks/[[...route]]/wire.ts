/**
 * The webhooks family's wire contract: what the RPC surface accepts, what it
 * publishes, and the two translations between the stored shape and either.
 *
 * Every enum this surface publishes and accepts is lower_snake_case, input AND
 * output, with no dual-casing tolerance: the stored SCREAMING_SNAKE is Prisma's
 * convention, not a contract, and `toWireEnum` / `toStoredEnum` translate at
 * this seam in both directions.
 */
import type { WebhookEndpointService } from "@ee/webhooks/webhookEndpoint.service";
import type { WebhookEventsService } from "@ee/webhooks/webhookEvents.service";
import type { WebhookHealthService } from "@ee/webhooks/webhookHealth.service";
import { z } from "zod";

import { toWireEnum } from "~/server/gateway/wireEnums";

/** What `.provide()` puts on `app` for every handler in this family. */
export interface WebhooksFamilyApp {
  endpoints: WebhookEndpointService;
  health: WebhookHealthService;
  events: () => WebhookEventsService;
}

// ── Inputs ────────────────────────────────────────────────────────────────
// Under REST every one of these identifiers was a raw `c.req.param("id")` with
// no schema at all. Folding them into the RPC body is what finally validates
// them.

export const endpointStatusSchema = z.enum(["active", "disabled"]);

const deliveryControlsSchema = {
  max_batch_size: z.number().int().optional(),
  max_batch_delay_ms: z.number().int().optional(),
  max_in_flight: z.number().int().optional(),
};

/** Names one endpoint. The shape every per-endpoint operation starts from. */
export const endpointRefSchema = z.object({
  id: z.string().min(1).max(200),
});

export const createEndpointSchema = z.object({
  url: z.string().min(1).max(2000),
  enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100),
  ...deliveryControlsSchema,
});

export const updateEndpointSchema = endpointRefSchema.extend({
  url: z.string().min(1).max(2000).optional(),
  enabled_events: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(100)
    .optional(),
  status: endpointStatusSchema.optional(),
  ...deliveryControlsSchema,
});

export const listDeliveriesSchema = endpointRefSchema.extend({
  cursor: z.string().max(500).optional(),
  limit: z.number().int().positive().max(200).optional().default(50),
});

export const listEventsSchema = z
  .object({
    type: z.string().min(1).max(200).optional(),
    // The events log is a RANGED read by contract, the same contract the
    // spend-events pull carries and over the same table: without bounds the
    // walk sorts the whole 13-month table under FINAL on every page.
    from: z.number().int().positive().safe(),
    to: z.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.number().int().positive().max(200).optional().default(50),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

export const eventRefSchema = z.object({
  id: z.string().min(1).max(500),
});

// ── Outputs ───────────────────────────────────────────────────────────────
// Under REST these were described for OpenAPI and never checked. As `output`
// schemas the framework validates them, so the published spec and the actual
// bytes cannot drift.

export const endpointDtoSchema = z.object({
  id: z.string(),
  url: z.string(),
  enabled_events: z.array(z.string()),
  status: endpointStatusSchema,
  /** `manual` when an operator paused it, `auto_failures_72h` when the
   *  failure ladder did. Null while the endpoint is active. */
  disabled_reason: z.string().nullable(),
  disabled_at: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  max_batch_size: z.number().int(),
  max_batch_delay_ms: z.number().int(),
  max_in_flight: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * The endpoint plus its plaintext signing secret. Create and roll-secret are
 * the only two responses that carry it; every read serves
 * {@link endpointDtoSchema}, which has no `secret` field to be absent from.
 */
export const endpointWithSecretDtoSchema = endpointDtoSchema.extend({
  secret: z.string(),
});

export const deliveryDtoSchema = z.object({
  id: z.string(),
  /** The send this attempt belongs to; retries of one batch share it. */
  dispatch_id: z.string(),
  attempt: z.number().int(),
  event_count: z.number().int(),
  outcome: z.enum(["success", "retryable", "terminal", "pending"]),
  response_status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  fired_at: z.string(),
});

export const healthDtoSchema = z.object({
  status: endpointStatusSchema,
  disabled_reason: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  /** Null when everything produced has been delivered. */
  oldest_undelivered_age_ms: z.number().int().nullable(),
  dlq_depth: z.number().int(),
  sends_per_minute: z.number(),
  /** Delivered over attempted in the last hour; null with no attempts. */
  success_rate: z.number().nullable(),
  p95_latency_ms: z.number().int().nullable(),
});

export const eventTypeDtoSchema = z.object({
  type: z.string(),
  family: z.string(),
  schema_version: z.string(),
  is_emitting: z.boolean(),
  description: z.string(),
});

/**
 * One emitted event, the SAME envelope the signed deliveries carry, so a pull
 * and a receiver parse with one reader. `data` is the per-type business payload
 * and stays an open object: every family carries its own cut, and a closed
 * shape here would describe only one of them.
 */
export const webhookEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * A test fire's outcome. `response_body` carries the receiver's answer,
 * truncated, when one arrived; `error` replaces it with `response_status` null
 * when the delivery never reached a receiver at all.
 */
export const testFireResultSchema = z.object({
  delivered: z.boolean(),
  response_status: z.number().int().nullable(),
  response_body: z.string().optional(),
  error: z.string().optional(),
});

/** The paging half of every cursor-paged list on this surface. */
export const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

export const archivedDtoSchema = z.object({ archived: z.literal(true) });

// ── Mappers ───────────────────────────────────────────────────────────────

export function endpointResponse(endpoint: {
  id: string;
  url: string;
  enabledEvents: string[];
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  disabledAt: Date | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof endpointDtoSchema> {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled_events: endpoint.enabledEvents,
    status: toWireEnum(endpoint.status),
    disabled_reason: endpoint.disabledReason,
    disabled_at: endpoint.disabledAt?.toISOString() ?? null,
    failing_since: endpoint.failingSince?.toISOString() ?? null,
    last_success_at: endpoint.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: endpoint.lastFailureAt?.toISOString() ?? null,
    max_batch_size: endpoint.maxBatchSize,
    max_batch_delay_ms: endpoint.maxBatchDelayMs,
    max_in_flight: endpoint.maxInFlight,
    created_at: endpoint.createdAt.toISOString(),
    updated_at: endpoint.updatedAt.toISOString(),
  };
}

export function deliveryResponse(delivery: {
  id: string;
  dispatchId: string;
  attempt: number;
  eventCount: number;
  outcome: "success" | "retryable" | "terminal" | "pending";
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  firedAt: Date;
}): z.infer<typeof deliveryDtoSchema> {
  return {
    id: delivery.id,
    dispatch_id: delivery.dispatchId,
    attempt: delivery.attempt,
    event_count: delivery.eventCount,
    outcome: delivery.outcome,
    response_status: delivery.responseStatus,
    latency_ms: delivery.latencyMs,
    error: delivery.error,
    fired_at: delivery.firedAt.toISOString(),
  };
}

export function healthResponse(report: {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  oldestUndeliveredAgeMs: number | null;
  dlqDepth: number;
  sendsPerMinute: number;
  successRate: number | null;
  p95LatencyMs: number | null;
}): z.infer<typeof healthDtoSchema> {
  return {
    status: toWireEnum(report.status),
    disabled_reason: report.disabledReason,
    failing_since: report.failingSince?.toISOString() ?? null,
    last_success_at: report.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: report.lastFailureAt?.toISOString() ?? null,
    oldest_undelivered_age_ms: report.oldestUndeliveredAgeMs,
    dlq_depth: report.dlqDepth,
    sends_per_minute: report.sendsPerMinute,
    success_rate: report.successRate,
    p95_latency_ms: report.p95LatencyMs,
  };
}
