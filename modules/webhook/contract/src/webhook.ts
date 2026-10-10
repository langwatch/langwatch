import type { Named } from "@langwatch/module";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

export const WEBHOOK_FEATURE_ID = "webhook" as const;

export const webhookDestinationKindSchema = z.enum(["http", "sqs"]);
export type WebhookDestinationKind = z.infer<typeof webhookDestinationKindSchema>;

/**
 * How an endpoint formats and signs: absent is the batch envelope signed `t=,v1=`; `legacy_sha256`
 * is one raw message per POST signed `sha256=`, only for endpoints migrated from governance
 * anomaly destinations (request delivery Q2 and Q3, 2026-10-05).
 */
export const webhookSignatureSchemeSchema = z.enum(["legacy_sha256"]);
export type WebhookSignatureScheme = z.infer<typeof webhookSignatureSchemeSchema>;

export const sqsCredentialModeSchema = z.enum(["assume_role", "static", "ambient"]);
export type SqsCredentialMode = z.infer<typeof sqsCredentialModeSchema>;

export const webhookDeliveryOutcomeSchema = z.enum(["success", "retryable", "terminal"]);
export type WebhookDeliveryOutcome = z.infer<typeof webhookDeliveryOutcomeSchema>;

const webhookDeliveryControlsSchemaDefinition = z.object({
  maxBatchSize: z.number().int().min(1).max(100),
  maxBatchDelayMs: z.number().int().min(0).max(60_000),
  maxInFlight: z.number().int().min(1).max(8),
});
export interface WebhookDeliveryControlsSchema extends Named<
  typeof webhookDeliveryControlsSchemaDefinition
> {}
export const webhookDeliveryControlsSchema: WebhookDeliveryControlsSchema =
  webhookDeliveryControlsSchemaDefinition;
export type WebhookDeliveryControls = z.infer<typeof webhookDeliveryControlsSchema>;

const sqsDestinationInputSchemaDefinition = z.object({
  queueUrl: z.string().min(1),
  roleArn: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  accessKeyId: z.string().nullable().optional(),
  secretAccessKey: z.string().nullable().optional(),
});
export interface SqsDestinationInputSchema extends Named<
  typeof sqsDestinationInputSchemaDefinition
> {}
export const sqsDestinationInputSchema: SqsDestinationInputSchema =
  sqsDestinationInputSchemaDefinition;
export type SqsDestinationInput = z.infer<typeof sqsDestinationInputSchema>;

const sqsDestinationViewSchemaDefinition = z.object({
  queueUrl: z.string(),
  region: z.string(),
  accountId: z.string(),
  queueName: z.string(),
  credentialMode: sqsCredentialModeSchema,
  roleArn: z.string().nullable(),
  externalId: z.string().nullable(),
  accessKeyId: z.string().nullable(),
});
export interface SqsDestinationViewSchema extends Named<
  typeof sqsDestinationViewSchemaDefinition
> {}
export const sqsDestinationViewSchema: SqsDestinationViewSchema =
  sqsDestinationViewSchemaDefinition;
export type SqsDestinationView = z.infer<typeof sqsDestinationViewSchema>;

const webhookEndpointViewSchemaDefinition = z.object({
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
  /** Self-hosted only: deliveries accept a receiver's self-signed certificate. */
  allowSelfSignedCertificate: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface WebhookEndpointViewSchema extends Named<
  typeof webhookEndpointViewSchemaDefinition
> {}
export const webhookEndpointViewSchema: WebhookEndpointViewSchema =
  webhookEndpointViewSchemaDefinition;
export type WebhookEndpointView = z.infer<typeof webhookEndpointViewSchema>;

const webhookEnvelopeSchemaDefinition = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.iso.datetime(),
  schema_version: z.literal("1"),
  data: z.record(z.string(), z.unknown()),
});
export interface WebhookEnvelopeSchema extends Named<typeof webhookEnvelopeSchemaDefinition> {}
export const webhookEnvelopeSchema: WebhookEnvelopeSchema = webhookEnvelopeSchemaDefinition;
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

const webhookEndpointHealthSchemaDefinition = z.object({
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
export interface WebhookEndpointHealthSchema extends Named<
  typeof webhookEndpointHealthSchemaDefinition
> {}
export const webhookEndpointHealthSchema: WebhookEndpointHealthSchema =
  webhookEndpointHealthSchemaDefinition;
export type WebhookEndpointHealth = z.infer<typeof webhookEndpointHealthSchema>;

/**
 * A newly created or re-secreted endpoint. The signing secret crosses to the
 * client exactly here and in a roll, once each time; every read answers a view
 * with no secret material on it.
 */
const webhookEndpointWithSecretSchemaDefinition = z
  .object({ endpoint: webhookEndpointViewSchema, secret: z.string() })
  .strict();
export interface WebhookEndpointWithSecretSchema extends Named<
  typeof webhookEndpointWithSecretSchemaDefinition
> {}
export const webhookEndpointWithSecretSchema: WebhookEndpointWithSecretSchema =
  webhookEndpointWithSecretSchemaDefinition;

/** One delivery attempt, as the endpoint's activity list renders it. */
const webhookDeliveryAttemptSchemaDefinition = z
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
export interface WebhookDeliveryAttemptSchema extends Named<
  typeof webhookDeliveryAttemptSchemaDefinition
> {}
export const webhookDeliveryAttemptSchema: WebhookDeliveryAttemptSchema =
  webhookDeliveryAttemptSchemaDefinition;

/** One page of delivery attempts, newest first, with the cursor for the next. */
const webhookDeliveryPageSchemaDefinition = z
  .object({
    deliveries: z.array(webhookDeliveryAttemptSchema),
    nextCursor: z.object({ firedAt: z.date(), id: z.string() }).strict().nullable(),
  })
  .strict();
export interface WebhookDeliveryPageSchema extends Named<
  typeof webhookDeliveryPageSchemaDefinition
> {}
export const webhookDeliveryPageSchema: WebhookDeliveryPageSchema =
  webhookDeliveryPageSchemaDefinition;

/**
 * The same page as the application holds it: an instant, not the wire date the
 * schema above publishes. A door converts at its own edge, so a second door
 * cannot inherit the first one's calendar.
 */
export type WebhookDeliveryAttemptRecord = {
  id: string;
  dispatchId: string;
  attempt: number;
  eventCount: number;
  outcome: WebhookDeliveryOutcome;
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  firedAt: Instant;
};

/** Where a delivery walk resumes: the attempt it last answered. */
export type WebhookDeliveryPosition = { firedAt: Instant; id: string };

export type WebhookDeliveryLog = {
  deliveries: WebhookDeliveryAttemptRecord[];
  nextCursor: WebhookDeliveryPosition | null;
};

/**
 * A test fire's outcome, over the same last hop a real delivery dispatches
 * through. `responseBody`/`error` are truncated summaries; `responseBody` is
 * absent only when the fire never reached a receiver.
 */
export type WebhookTestFireResult =
  | { delivered: true; responseStatus: number | null; responseBody: string }
  | { delivered: false; responseStatus: number | null; responseBody?: string; error: string };
