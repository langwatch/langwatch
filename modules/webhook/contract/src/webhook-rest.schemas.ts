/**
 * What the `/api/webhooks/v1` surface publishes on the wire. Every enum here
 * is lower_snake_case, input AND output: the stored SCREAMING_SNAKE is
 * Prisma's convention, not a contract.
 */
import { z } from "zod";

import { webhookDestinationKindSchema } from "./webhook.ts";

export const endpointStatusSchema = z.enum(["active", "disabled"]);

const sqsDestinationDtoSchema = z.object({
  queue_url: z.string(),
  region: z.string(),
  account_id: z.string(),
  queue_name: z.string(),
  credential_mode: z.enum(["assume_role", "static", "ambient"]),
  role_arn: z.string().nullable(),
  external_id: z.string().nullable(),
  access_key_id: z.string().nullable(),
});

const endpointCommonDtoFields = {
  id: z.string(),
  enabled_events: z.array(z.string()),
  status: endpointStatusSchema,
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
};

const httpEndpointDtoSchema = z.object({
  destination_kind: z.literal("http"),
  url: z.string(),
  sqs: z.null(),
  ...endpointCommonDtoFields,
});

const sqsEndpointDtoSchema = z.object({
  destination_kind: z.literal("sqs"),
  url: z.null(),
  sqs: sqsDestinationDtoSchema,
  ...endpointCommonDtoFields,
});

export const endpointDtoSchema = z.discriminatedUnion("destination_kind", [
  httpEndpointDtoSchema,
  sqsEndpointDtoSchema,
]);

export const endpointWithSecretDtoSchema = z.discriminatedUnion("destination_kind", [
  z.object({ ...httpEndpointDtoSchema.shape, secret: z.string() }),
  z.object({ ...sqsEndpointDtoSchema.shape, secret: z.string() }),
]);

export const deliveryDtoSchema = z.object({
  id: z.string(),
  dispatch_id: z.string(),
  attempt: z.number().int(),
  event_count: z.number().int(),
  outcome: z.enum(["success", "retryable", "terminal", "pending"]),
  response_status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  fired_at: z.string(),
});

export const eventTypeDtoSchema = z.object({
  type: z.string(),
  family: z.string(),
  schema_version: z.string(),
  is_emitting: z.boolean(),
  description: z.string(),
});

export const webhookEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

// Every list on this surface answers under `data`. The envelope cannot be
// dropped: `/deliveries` pages, and `next_cursor` has nowhere to live beside
// a bare array — so the three are one shape, named once each.

export const endpointListResponseSchema = z.object({
  data: z.array(endpointDtoSchema),
});

export const eventTypeListResponseSchema = z.object({
  data: z.array(eventTypeDtoSchema),
});

export const deliveryListResponseSchema = z.object({
  data: z.array(deliveryDtoSchema),
  next_cursor: nextCursorSchema,
});

export const webhookEventListResponseSchema = z.object({
  data: z.array(webhookEventEnvelopeSchema),
  next_cursor: nextCursorSchema,
});

// Every single-resource answer is enveloped under `data` too, as main serves it.

export const endpointResponseSchema = z.object({ data: endpointDtoSchema });

export const endpointWithSecretResponseSchema = z.object({ data: endpointWithSecretDtoSchema });

export const endpointArchivedResponseSchema = z.object({
  data: z.object({ archived: z.literal(true) }),
});

export const webhookEventResponseSchema = z.object({ data: webhookEventEnvelopeSchema });

const deliveryControlsSchema = {
  max_batch_size: z.number().int().optional(),
  max_batch_delay_ms: z.number().int().optional(),
  max_in_flight: z.number().int().optional(),
};

const destinationKindSchema = webhookDestinationKindSchema;

/**
 * The queue half of a destination. Only the queue URL is ever required: the
 * credential fields select which of the three modes the endpoint runs in, and
 * which of them are allowed is the service's call, not this schema's.
 */
const sqsDestinationSchema = z.object({
  queue_url: z.string().min(1).max(2000),
  role_arn: z.string().min(1).max(2048).optional(),
  external_id: z.string().min(1).max(1224).optional(),
  access_key_id: z.string().min(1).max(128).optional(),
  secret_access_key: z.string().min(1).max(256).optional(),
});

/**
 * Each kind requires its own address and refuses both at once (an endpoint
 * stores one); a superRefine puts the 400's message on the offending field.
 */
function refineDestinationShape(
  body: {
    destination_kind?: "http" | "sqs";
    url?: string;
    sqs?: { queue_url: string };
  },
  ctx: z.RefinementCtx,
): void {
  const kind = body.destination_kind ?? "http";
  if (kind === "http" && !body.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "url is required when destination_kind is http",
    });
  }
  if (kind === "http" && body.sqs !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sqs"],
      message:
        "sqs does not apply when destination_kind is http; remove it, or set destination_kind to sqs",
    });
  }
  if (kind === "sqs" && !body.sqs?.queue_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sqs", "queue_url"],
      message: "sqs.queue_url is required when destination_kind is sqs",
    });
  }
  if (kind === "sqs" && body.url !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message:
        "url does not apply when destination_kind is sqs; the queue URL goes in sqs.queue_url",
    });
  }
}

export const createEndpointSchema = z
  .object({
    /**
     * Absent means http, which is what every endpoint was before there was more than one kind.
     */
    destination_kind: destinationKindSchema.optional(),
    url: z.string().min(1).max(2000).optional(),
    sqs: sqsDestinationSchema.optional(),
    enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100),
    ...deliveryControlsSchema,
  })
  .superRefine(refineDestinationShape);

export const updateEndpointSchema = z.object({
  /**
   * Accepted only when it repeats the kind the endpoint already has; the service refuses a change,
   * because batches planned against the old transport are already in the outbox.
   */
  destination_kind: destinationKindSchema.optional(),
  url: z.string().min(1).max(2000).optional(),
  sqs: sqsDestinationSchema.partial().optional(),
  enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  status: endpointStatusSchema.optional(),
  ...deliveryControlsSchema,
});

export const deliveriesQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const eventsQuerySchema = z
  .object({
    type: z.string().min(1).max(200).optional(),
    // The events log is a RANGED read by contract, the same contract the
    // spend-events pull carries and over the same table: without bounds the
    // walk sorts the whole 13-month table under FINAL on every page.
    from: z.coerce.number().int().positive().safe(),
    to: z.coerce.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// {@link endpointResponse} is the one builder behind create, list, get,
// patch and roll-secret, so one schema describes all five.

export const healthDtoSchema = z.object({
  status: endpointStatusSchema,
  disabled_reason: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  oldest_undelivered_age_ms: z.number().int().nullable(),
  dlq_depth: z.number().int(),
  sends_per_minute: z.number(),
  success_rate: z.number().nullable(),
  p95_latency_ms: z.number().int().nullable(),
});

export const testFireResultSchema = z.object({
  delivered: z.boolean(),
  response_status: z.number().int().nullable(),
  response_body: z.string().optional(),
  error: z.string().optional(),
});

export const healthResponseSchema = z.object({ data: healthDtoSchema });

export const testFireResponseSchema = z.object({ data: testFireResultSchema });

/** A secret roll takes no body: the endpoint travels in the path. */
export const rollEndpointSecretBodySchema = z.object({});

/** A test fire takes no body: the endpoint travels in the path. */
export const testEndpointBodySchema = z.object({});
