/**
 * What the `/api/webhooks/v1` surface publishes on the wire. Every enum here
 * is lower_snake_case, input AND output: the stored SCREAMING_SNAKE is
 * Prisma's convention, not a contract.
 */
import { z } from "zod";

export const endpointStatusSchema = z.enum(["active", "disabled"]);

const sqsDestinationDtoSchema = z.object({
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
  httpEndpointDtoSchema.extend({ secret: z.string() }),
  sqsEndpointDtoSchema.extend({ secret: z.string() }),
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
