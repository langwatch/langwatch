import { z } from "zod";
import { Temporal } from "@langwatch/time";
import { spendUsageSchema, type SpendUsage } from "@langwatch/gateway-contract";

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
 * Schema-snapshot version of the gatewaySpend fold, stamped on the projected
 * row. The read-back only trusts the current stamp, so an older-shape row
 * refolds from the event log instead of decoding wrong column defaults.
 */
export const GATEWAY_SPEND_PROJECTION_VERSION_LATEST = "2026-07-29";

/**
 * Command payloads for the gateway_spend_processing pipeline. *WireSchema
 * shapes are the Go gateway's ingest contract: priced once at ingest, then
 * CARRIED on the event so no two disagree. No prompt/response content, no PII.
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
  .min(
    Temporal.PlainDateTime.from({ year: 2020, month: 1, day: 1 }).toZonedDateTime("UTC")
      .epochMilliseconds,
  )
  .max(
    Temporal.PlainDateTime.from({ year: 2100, month: 1, day: 1 }).toZonedDateTime("UTC")
      .epochMilliseconds,
  );

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
 * Who a request is billed against. Carried on both admission and outcome so
 * a consumer reads attribution off one event, not durable per-request state;
 * every field defaults so an older build's record still parses cleanly.
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
   * The emitter repeats this attribution on the outcome so a consumer need not
   * persist anything at admission time; both come from the same build, so
   * gateway and control plane can roll independently. Removable once no fleet omits it.
   */
  outcome_carries_attribution: z.boolean().default(false),
});

/**
 * What the ingest seam appends after joining control-plane attribution the
 * gateway can't see: team_id, resolved per drain batch. Read only by the
 * debits process manager, so fold/webhook/envelope keep their frozen shapes.
 */
export const admitSpendCommandDataSchema = z.object({
  ...admitSpendWireSchema.shape,
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
export const confirmSpendCommandDataSchema = z.object({
  ...confirmSpendWireSchema.shape,
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
export const failSpendCommandDataSchema = z.object({
  ...failSpendWireSchema.shape,
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
   * The model identity ADMISSION requested — settlement resolves none of its
   * own, but the settled envelope has always carried it. Rides the command,
   * since reading only the outcome would silently empty this field.
   */
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
});
export type SettleSpendCommandData = z.infer<typeof settleSpendCommandDataSchema>;
