/**
 * The gateway spend events webhook delivery consumes, as the delivery
 * pipeline's one command carries them: main's delivery process manager read
 * these off gateway_spend, and now gateway hands each one over.
 */
import { z } from "zod";

export const WEBHOOK_DELIVERY_PIPELINE_NAME = "webhook_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE = "webhook_spend_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE =
  "lw.webhook.spend_delivery.requested" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION = "2026-09-25" as const;
export const REQUEST_SPEND_DELIVERY_COMMAND_TYPE = "lw.webhook.request_spend_delivery" as const;

const count = z.number().int().min(0).default(0);

const spendUsageSchema = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_read_input_tokens: count,
  cache_creation_input_tokens: count,
  cache_creation_1h_tokens: count,
  reasoning_tokens: count,
  input_audio_tokens: count,
  output_audio_tokens: count,
  input_chars: count,
  audio_ms: count,
  input_image_tokens: count,
  output_image_tokens: count,
  image_count: count,
});

const spendAttributionSchema = z.object({
  organization_id: z.string().default(""),
  virtual_key_id: z.string().default(""),
  principal_user_id: z.string().default(""),
  end_user_id: z.string().default(""),
  model: z.string().default(""),
  model_provider_id: z.string().default(""),
  trace_id: z.string().default(""),
  request_type: z.string().default(""),
  labels: z.array(z.string()).default([]),
  metadata: z.string().default(""),
});

const spendStepSchema = z.object({
  gateway_request_id: z.string().min(1),
  occurred_at: z.number().int().min(0),
  tenantId: z.string().min(1),
});

const spendOutcomeSchema = z.object({
  ...spendAttributionSchema.shape,
  ...spendStepSchema.shape,
  admitted_at: count,
  usage: spendUsageSchema,
  cost_nano_usd: count,
  rate_version: z.string().default(""),
  duration_ms: count,
});

/** One gateway spend event, typed by the lifecycle step it records. */
export const webhookSpendEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("lw.gateway.spend.admitted"),
    data: z.object({
      ...spendAttributionSchema.shape,
      ...spendStepSchema.shape,
      outcome_carries_attribution: z.boolean().default(false),
    }),
  }),
  z.object({ type: z.literal("lw.gateway.spend.confirmed"), data: spendOutcomeSchema }),
  z.object({
    type: z.literal("lw.gateway.spend.failed"),
    data: z.object({
      ...spendOutcomeSchema.shape,
      error: z.object({ type: z.string(), http_status: count }),
    }),
  }),
  z.object({
    type: z.literal("lw.gateway.spend.settled"),
    data: z.object({
      ...spendAttributionSchema.shape,
      ...spendStepSchema.shape,
      admitted_at: count,
      reason: z.string(),
    }),
  }),
]);
export type WebhookSpendEvent = z.infer<typeof webhookSpendEventSchema>;

/** What gateway hands over: the committed spend event, named by its id. */
export const webhookSpendDeliveryRequestSchema = z.object({
  sourceEventId: z.string().min(1),
  spend: webhookSpendEventSchema,
});
export type WebhookSpendDeliveryRequest = z.infer<typeof webhookSpendDeliveryRequestSchema>;
