import { z } from "zod";

/**
 * Command payloads for the gateway_spend_processing pipeline.
 *
 * The `*WireSchema` shapes are the contract of the internal ingest route
 * the Go gateway posts command batches to, so every field the gateway
 * resolves at admission (attribution, end user, metadata echo, labels) or
 * learns at completion (usage by token class, error taxonomy) is declared
 * there and nowhere else. No cost crosses that boundary: quantities
 * travel, the server prices them.
 *
 * The command schemas are what the pipeline appends, and an outcome is
 * priced exactly once, at the ingest seam that mints the command. The
 * event then CARRIES the money: the fold, the attributed-user debits, and
 * the webhook envelope all copy the same `cost_nano_usd`, so no two of
 * them can disagree about what one request cost no matter when each runs.
 * No prompt or response content, no PII.
 */

/** Bounds mirror the gateway edge: ids are opaque tokens, metadata is a
 *  validated JSON object capped at 4KB before it ever reaches a command. */
const boundedId = z.string().min(1).max(256);
const boundedMetadataJson = z
  .string()
  .max(4096)
  .refine(
    (raw) => {
      if (raw === "") return true;
      try {
        const parsed: unknown = JSON.parse(raw);
        return (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        );
      } catch {
        return false;
      }
    },
    { message: "metadata must be a JSON object string" },
  )
  .default("");

/** Request time, unix ms, bounded to the plausible clock range so a
 *  seconds- or microseconds-scale timestamp fails at the ingest boundary
 *  instead of landing in the wrong partition. */
const occurredAtMs = z
  .number()
  .int()
  .min(Date.UTC(2020, 0, 1))
  .max(Date.UTC(2100, 0, 1));

export const spendUsageSchema = z.object({
  input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(0),
  cache_read_input_tokens: z.number().int().min(0).default(0),
  cache_creation_input_tokens: z.number().int().min(0).default(0),
  reasoning_tokens: z.number().int().min(0).default(0),
});
export type SpendUsage = z.infer<typeof spendUsageSchema>;

export const admitSpendWireSchema = z.object({
  gateway_request_id: boundedId,
  /** Request time, unix ms. Period placement anchors here, never ingest time. */
  occurred_at: occurredAtMs,
  organization_id: boundedId,
  /** TenantId = project id; the framework's group keys and every ClickHouse
   *  filter key off this. The ingest route maps the wire's project_id here. */
  tenantId: boundedId,
  virtual_key_id: boundedId,
  /** The key's owner. The gateway does not carry it: the ingest seam reads
   *  it off the key row when it joins the rest of the attribution. */
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

/** What the ingest seam appends once it has joined the control-plane
 *  attribution the gateway cannot see: `team_id` is the tenant project's
 *  team, resolved per drain batch alongside the key's principal. The debits
 *  process manager is its only reader, so the fold, the webhook process
 *  manager and the delivered envelope keep the shapes they were frozen at;
 *  adopting the team on any of them later costs no wire change. */
export const admitSpendCommandDataSchema = admitSpendWireSchema.extend({
  team_id: z.string().max(256).default(""),
});
export type AdmitSpendCommandData = z.infer<typeof admitSpendCommandDataSchema>;

export const confirmSpendWireSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: occurredAtMs,
  tenantId: boundedId,
  /** The RESOLVED model + provider: identity only settles post-dispatch in
   *  the gateway, so the outcome carries it and wins over admitted's
   *  requested values. */
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
  usage: spendUsageSchema,
  /** Rate identity the gateway resolved, if any; empty lets the ingest
   *  seam stamp the registry version it priced with. */
  rate_version: z.string().max(128).default(""),
  duration_ms: z.number().int().min(0).default(0),
});

/** What the ingest seam appends once it has priced the outcome.
 *  `cost_nano_usd` is that price and `rate_version` the stamp of the
 *  rating that produced it; every consumer copies the pair. */
export const confirmSpendCommandDataSchema = confirmSpendWireSchema.extend({
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string().min(1).max(128),
});
export type ConfirmSpendCommandData = z.infer<
  typeof confirmSpendCommandDataSchema
>;

export const failSpendWireSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: occurredAtMs,
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

/** Partial usage still prices, so a failure carries the same priced pair a
 *  confirmation does. */
export const failSpendCommandDataSchema = failSpendWireSchema.extend({
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string().min(1).max(128),
});
export type FailSpendCommandData = z.infer<typeof failSpendCommandDataSchema>;

export const settleSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: occurredAtMs,
  tenantId: boundedId,
  /** Why settlement fired (e.g. confirmation_deadline_expired). */
  reason: z.string().min(1).max(128),
});
export type SettleSpendCommandData = z.infer<
  typeof settleSpendCommandDataSchema
>;
