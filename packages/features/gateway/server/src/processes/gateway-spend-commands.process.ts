import { z } from "zod";

export const GATEWAY_SPEND_PIPELINE_NAME = "gateway_spend_processing" as const;
export const GATEWAY_SPEND_AGGREGATE_TYPE = "gateway_request" as const;

export const ADMIT_SPEND_COMMAND_TYPE = "lw.gateway_request.admit_spend" as const;
export const CONFIRM_SPEND_COMMAND_TYPE = "lw.gateway_request.confirm_spend" as const;
export const FAIL_SPEND_COMMAND_TYPE = "lw.gateway_request.fail_spend" as const;
export const SETTLE_SPEND_COMMAND_TYPE = "lw.gateway_request.settle_spend" as const;

export const GATEWAY_SPEND_PROCESSING_COMMAND_TYPES = [
  ADMIT_SPEND_COMMAND_TYPE,
  CONFIRM_SPEND_COMMAND_TYPE,
  FAIL_SPEND_COMMAND_TYPE,
  SETTLE_SPEND_COMMAND_TYPE,
] as const;

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE = "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE = "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE = "lw.gateway.spend.failed" as const;
export const GATEWAY_SPEND_SETTLED_EVENT_TYPE = "lw.gateway.spend.settled" as const;

export const GATEWAY_SPEND_PROCESSING_EVENT_TYPES = [
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
] as const;

export const GATEWAY_SPEND_EVENT_VERSION_LATEST = "2026-07-29" as const;

/**
 * Schema-snapshot version of the gatewaySpend fold (calendar date), stamped on the projected row; the store's read-back only trusts the current stamp, so an older-shape row refolds once from the event log instead of decoding column defaults into wrong state.
 */
export const GATEWAY_SPEND_PROJECTION_VERSION_LATEST = "2026-07-29";

/**
 * Command payloads for the gateway_spend_processing pipeline. *WireSchema shapes are the internal ingest route's contract with the Go gateway — every admission/completion field is declared there and nowhere else, and no cost crosses that boundary (quantities travel, the server prices them). An outcome is priced exactly once at the ingest seam; the event then CARRIES the money (fold, attributed-user debits and webhook envelope all copy the same cost_nano_usd) so no two can disagree. No prompt/response content, no PII.
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
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
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

/**
 * Every quantity a provider bills by, one named integer field each — not a map, which would kill sumIf rollups, lose per-field defaults, and turn a typo into a silently unpriced quantity; every field defaults to zero. input/output_audio_tokens and input/output_image_tokens are DISJOINT from the text token counts (audio/image price several times higher; charging both would double that portion); image_count is display-only; reasoning_tokens stays a subset of output_tokens, also display-only. audio_ms is whole milliseconds; the one division by 1000 happens at the rating seam.
 */
export const spendUsageSchema = z.object({
  input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(0),
  cache_read_input_tokens: z.number().int().min(0).default(0),
  cache_creation_input_tokens: z.number().int().min(0).default(0),
  cache_creation_1h_tokens: z.number().int().min(0).default(0),
  reasoning_tokens: z.number().int().min(0).default(0),
  input_audio_tokens: z.number().int().min(0).default(0),
  output_audio_tokens: z.number().int().min(0).default(0),
  /** Characters synthesized, what TTS is priced by. */
  input_chars: z.number().int().min(0).default(0),
  /** Audio duration in whole milliseconds. */
  audio_ms: z.number().int().min(0).default(0),
  input_image_tokens: z.number().int().min(0).default(0),
  output_image_tokens: z.number().int().min(0).default(0),
  /** Images the response carried. Observability only, never priced. */
  image_count: z.number().int().min(0).default(0),
});
export type SpendUsage = z.infer<typeof spendUsageSchema>;

/** Every quantity at zero: what a request that measured nothing carries. */
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

/**
 * Who a request is billed against, as the gateway knows it — carried on both admission and outcome so a consumer can read attribution off the one event it's handling, rather than keeping durable per-request state to join them; the Go emitter fills it from the same call.Bundle admission reads, so the two can never disagree. Every field defaults, since a record from a previous build is read back by this one and a field without a default would be a permanent parse failure rather than a billed request.
 */
export const spendAttributionWireSchema = z.object({
  organization_id: z.string().max(256).default(""),
  virtual_key_id: z.string().max(256).default(""),
  end_user_id: z.string().max(256).default(""),
  trace_id: z.string().max(128).default(""),
  request_type: z.string().max(64).default(""),
  labels: z.array(z.string().max(256)).max(64).default([]),
  metadata: boundedMetadataJson,
  /** Admission instant, unix ms; 0 when the emitter did not carry one. */
  admitted_at: z.number().int().min(0).default(0),
});

/** What the ingest seam joins from the control plane, which the gateway
 *  cannot see. Mirrored onto the outcomes so a consumer reading attribution
 *  off an outcome gets the same shape admission gives it. */
export const spendControlPlaneAttributionSchema = z.object({
  principal_user_id: z.string().max(256).default(""),
  team_id: z.string().max(256).default(""),
});

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
  /**
   * The emitter repeats this attribution on the outcome, so a consumer joining the two need not persist anything at admission time. Declared on the admission (the decision must be made before the outcome exists), and always self-consistent since both come from the same pod/build — letting gateway and control plane roll in either order. Removable once no fleet runs a build that omits it.
   */
  outcome_carries_attribution: z.boolean().default(false),
});

/**
 * What the ingest seam appends after joining control-plane attribution the gateway can't see: team_id, resolved per drain batch alongside the key's principal. The debits process manager is its only reader, so the fold, webhook process manager and delivered envelope keep their frozen shapes — adopting team_id later costs no wire change.
 */
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
  ...spendAttributionWireSchema.shape,
});

/** What the ingest seam appends once it has priced the outcome.
 *  `cost_nano_usd` is that price and `rate_version` the stamp of the
 *  rating that produced it; every consumer copies the pair. The
 *  control-plane attribution rides along for the same reason it rides on
 *  admission: only the seam can see it. */
export const confirmSpendCommandDataSchema = confirmSpendWireSchema.extend({
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string().min(1).max(128),
  ...spendControlPlaneAttributionSchema.shape,
});
export type ConfirmSpendCommandData = z.infer<typeof confirmSpendCommandDataSchema>;

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
  usage: spendUsageSchema.default(EMPTY_SPEND_USAGE),
  duration_ms: z.number().int().min(0).default(0),
  ...spendAttributionWireSchema.shape,
});

/** Partial usage still prices, so a failure carries the same priced pair a
 *  confirmation does. */
export const failSpendCommandDataSchema = failSpendWireSchema.extend({
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string().min(1).max(128),
  ...spendControlPlaneAttributionSchema.shape,
});
export type FailSpendCommandData = z.infer<typeof failSpendCommandDataSchema>;

export const settleSpendCommandDataSchema = z.object({
  gateway_request_id: boundedId,
  occurred_at: occurredAtMs,
  tenantId: boundedId,
  /** Why settlement fired (e.g. confirmation_deadline_expired). */
  reason: z.string().min(1).max(128),
  /** The settlement sweeper reads the open admission off the spend record,
   *  which already holds its attribution, so a settled envelope names the
   *  organization and key the request belonged to instead of arriving
   *  anonymous. */
  ...spendAttributionWireSchema.shape,
  ...spendControlPlaneAttributionSchema.shape,
  /**
   * The model identity ADMISSION requested — a settlement resolves none of its own, but the request still named one, and the settled envelope has always carried it. Rides the command rather than being recovered downstream because the consumer building the envelope no longer keeps the admission; reading only the outcome would silently empty the field on every settled delivery.
   */
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
});
export type SettleSpendCommandData = z.infer<typeof settleSpendCommandDataSchema>;
