import { z } from "zod";

export const WEBHOOK_FEATURE_ID = "webhook" as const;

export const webhookDestinationKindSchema = z.enum(["http", "sqs"]);
export type WebhookDestinationKind = z.infer<typeof webhookDestinationKindSchema>;

export const sqsCredentialModeSchema = z.enum(["assume_role", "static", "ambient"]);
export type SqsCredentialMode = z.infer<typeof sqsCredentialModeSchema>;

export const webhookDeliveryOutcomeSchema = z.enum(["success", "retryable", "terminal"]);
export type WebhookDeliveryOutcome = z.infer<typeof webhookDeliveryOutcomeSchema>;

export const webhookDeliveryControlsSchema = z.object({
  maxBatchSize: z.number().int().min(1).max(100),
  maxBatchDelayMs: z.number().int().min(0).max(60_000),
  maxInFlight: z.number().int().min(1).max(8),
});
export type WebhookDeliveryControls = z.infer<typeof webhookDeliveryControlsSchema>;

export const sqsDestinationInputSchema = z.object({
  queueUrl: z.string().min(1),
  roleArn: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  accessKeyId: z.string().nullable().optional(),
  secretAccessKey: z.string().nullable().optional(),
});
export type SqsDestinationInput = z.infer<typeof sqsDestinationInputSchema>;

export const sqsDestinationViewSchema = z.object({
  queueUrl: z.string(),
  region: z.string(),
  accountId: z.string(),
  queueName: z.string(),
  credentialMode: sqsCredentialModeSchema,
  roleArn: z.string().nullable(),
  externalId: z.string().nullable(),
  accessKeyId: z.string().nullable(),
});
export type SqsDestinationView = z.infer<typeof sqsDestinationViewSchema>;

export const webhookEndpointViewSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema,
  url: z.string().nullable(),
  sqs: sqsDestinationViewSchema.nullable(),
  enabledEvents: z.array(z.string()),
  status: z.enum(["ACTIVE", "DISABLED"]),
  disabledReason: z.string().nullable(),
  disabledAt: z.date().nullable(),
  failingSince: z.date().nullable(),
  lastSuccessAt: z.date().nullable(),
  lastFailureAt: z.date().nullable(),
  maxBatchSize: z.number().int(),
  maxBatchDelayMs: z.number().int(),
  maxInFlight: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WebhookEndpointView = z.infer<typeof webhookEndpointViewSchema>;

export const webhookEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.iso.datetime(),
  schema_version: z.literal("1"),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export const webhookEndpointHealthSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
  disabledReason: z.string().nullable(),
  failingSince: z.date().nullable(),
  lastSuccessAt: z.date().nullable(),
  lastFailureAt: z.date().nullable(),
  oldestUndeliveredAgeMs: z.number().min(0).nullable(),
  dlqDepth: z.number().int().min(0),
  sendsPerMinute: z.number().min(0),
  successRate: z.number().min(0).max(1).nullable(),
  p95LatencyMs: z.number().min(0).nullable(),
});
export type WebhookEndpointHealth = z.infer<typeof webhookEndpointHealthSchema>;

/**
 * A newly created or re-secreted endpoint. The signing secret crosses to the
 * client exactly here and in a roll, once each time; every read answers a view
 * with no secret material on it.
 */
export const webhookEndpointWithSecretSchema = z
  .object({ endpoint: webhookEndpointViewSchema, secret: z.string() })
  .strict();

/** One delivery attempt, as the endpoint's activity list renders it. */
export const webhookDeliveryAttemptSchema = z
  .object({
    id: z.string(),
    dispatchId: z.string(),
    attempt: z.number().int(),
    eventCount: z.number().int(),
    outcome: webhookDeliveryOutcomeSchema,
    responseStatus: z.number().int().nullable(),
    latencyMs: z.number().nullable(),
    error: z.string().nullable(),
    firedAt: z.date(),
  })
  .strict();

/** One page of delivery attempts, newest first, with the cursor for the next. */
export const webhookDeliveryPageSchema = z
  .object({
    deliveries: z.array(webhookDeliveryAttemptSchema),
    nextCursor: z.object({ firedAt: z.date(), id: z.string() }).strict().nullable(),
  })
  .strict();
