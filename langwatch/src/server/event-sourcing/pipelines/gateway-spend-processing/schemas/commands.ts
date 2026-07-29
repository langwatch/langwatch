import { z } from "zod";

/**
 * Command payloads for the gateway_spend_processing pipeline.
 *
 * These shapes are ALSO the wire contract of the internal ingest route the
 * Go gateway posts command batches to, so every field the gateway resolves
 * at admission (attribution, end user, metadata echo, labels) or learns at
 * completion (usage by token class, error taxonomy) is declared here and
 * nowhere else. No cost ever crosses this boundary: quantities travel,
 * rating happens in the fold. No prompt or response content, no PII.
 */

/** Bounds mirror the gateway edge: ids are opaque tokens, metadata is a
 *  validated JSON object capped at 4KB before it ever reaches a command. */
const boundedId = z.string().min(1).max(256);
const boundedMetadataJson = z.string().max(4096).default("");

export const spendUsageSchema = z.object({
  input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(0),
  cache_read_input_tokens: z.number().int().min(0).default(0),
  cache_creation_input_tokens: z.number().int().min(0).default(0),
  reasoning_tokens: z.number().int().min(0).default(0),
});
export type SpendUsage = z.infer<typeof spendUsageSchema>;

export const admitSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  /** Request time, unix ms. Period placement anchors here, never ingest time. */
  occurred_at: z.number().int().positive(),
  organization_id: boundedId,
  /** TenantId = project id; the framework's group keys and every ClickHouse
   *  filter key off this. The ingest route maps the wire's project_id here. */
  tenantId: boundedId,
  virtual_key_id: boundedId,
  principal_user_id: z.string().max(256).default(""),
  end_user_id: z.string().max(256).default(""),
  model: z.string().min(1).max(512),
  model_provider_id: z.string().max(256).default(""),
  /** The request's trace id (the gateway starts the span), so spend rows
   *  keep their observability join without depending on the span arriving. */
  trace_id: z.string().max(128).default(""),
  /** Wire shape served (chat, embeddings, responses, ...). */
  request_type: z.string().max(64).default(""),
  labels: z.array(z.string().max(256)).max(64).default([]),
  /** Caller echo (x-langwatch-metadata), raw JSON object string. */
  metadata: boundedMetadataJson,
  /** Emitting pod identity + per-pod monotonic sequence, persisted for the
   *  gap detector: a hole in (pod_id, pod_seq) is an asserted loss. */
  pod_id: z.string().max(128).default(""),
  pod_seq: z.number().int().min(0).default(0),
});
export type AdmitSpendCommandData = z.infer<typeof admitSpendCommandDataSchema>;

export const confirmSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: z.number().int().positive(),
  tenantId: boundedId,
  /** The RESOLVED model + provider: identity only settles post-dispatch in
   *  the gateway, so the outcome carries it and wins over admitted's
   *  requested values. */
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
  usage: spendUsageSchema,
  /** Rate identity the gateway resolved, if any; empty lets the fold stamp
   *  the registry version it rated with. */
  rate_version: z.string().max(128).default(""),
  duration_ms: z.number().int().min(0).default(0),
});
export type ConfirmSpendCommandData = z.infer<
  typeof confirmSpendCommandDataSchema
>;

export const failSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: z.number().int().positive(),
  tenantId: boundedId,
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
  /** Full gateway error taxonomy token (rate_limited, provider_timeout,
   *  provider_error, bad_request, end_user_required, ...): never collapsed. */
  error: z.object({
    type: z.string().min(1).max(128),
    http_status: z.number().int().min(0).max(599).default(0),
  }),
  /** Partial usage when the failure happened after tokens were consumed. */
  usage: spendUsageSchema.default({
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_tokens: 0,
  }),
  duration_ms: z.number().int().min(0).default(0),
});
export type FailSpendCommandData = z.infer<typeof failSpendCommandDataSchema>;

export const settleSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: z.number().int().positive(),
  tenantId: boundedId,
  /** Why settlement fired (e.g. confirmation_deadline_expired). */
  reason: z.string().min(1).max(128),
});
export type SettleSpendCommandData = z.infer<
  typeof settleSpendCommandDataSchema
>;
