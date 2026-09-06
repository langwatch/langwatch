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

/**
 * Every quantity a provider bills by, one named integer field each.
 *
 * Named rather than a generic map: a map kills the `sumIf` rollups, loses the
 * per-field default, and turns a typo into a silently unpriced quantity. Every
 * field defaults to zero, so a payload a previous gateway build wrote parses
 * with the quantities it never knew about reading as none.
 *
 * `input_audio_tokens` and `output_audio_tokens` are DISJOINT from
 * `input_tokens` and `output_tokens`: the gateway takes them out of the
 * provider's totals before emitting, because audio tokens price several times
 * higher and charging both would double the audio portion.
 * `input_image_tokens` and `output_image_tokens` are DISJOINT the same way:
 * the token-billed image models price output image tokens at six to eight
 * times text input, and an image call carries most of its cost there.
 * `image_count` is how many images the response carried, reported for
 * display and never priced.
 * `reasoning_tokens` is the exception and stays a subset of `output_tokens`,
 * reported for display and never priced.
 *
 * `audio_ms` is whole milliseconds. Money is integer nano-USD and quantities
 * are integers with it; the one division by 1000 happens at the rating seam.
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
 * Who a request is billed against, as the gateway itself knows it.
 *
 * Admission has always carried this. The outcomes carry it too, so a
 * consumer that needs attribution to do its job can read it off the one
 * event it is handling instead of keeping durable per-request state purely
 * to join admission to outcome. `outcomeFor` in the Go emitter fills it from
 * the same `call.Bundle` admission reads, so the two can never disagree.
 *
 * Every field defaults. These rows ride a bounded spool on the gateway and
 * an outbox payload here, so a record written by the previous build is read
 * back by this one, and a field without a default turns that record into a
 * permanent parse failure rather than a billed request.
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
   * The emitter that sent this admission will repeat the attribution on the
   * outcome, so a consumer joining the two need not persist anything at
   * admission time.
   *
   * It is the admission that declares this rather than the outcome, because
   * the decision has to be made when the admission is handled — before the
   * outcome exists. Both come from the same pod and the same build, so the
   * pair is always self-consistent: an old build omits it and keeps the
   * durable join, a new build sets it and skips it. That is what lets the
   * gateway and the control plane roll in either order.
   *
   * Removable once no fleet runs a build that omits it.
   */
  outcome_carries_attribution: z.boolean().default(false),
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
   * The model identity ADMISSION requested. A settlement resolved no model
   * of its own — that is what makes it a settlement — but the request still
   * named one, and the settled envelope has always carried it.
   *
   * It rides the command rather than being recovered downstream because the
   * consumer that builds the envelope no longer keeps the admission: it
   * reads what the outcome states, and a settlement that stated no model
   * would silently empty the field on every settled delivery.
   */
  model: z.string().max(512).default(""),
  model_provider_id: z.string().max(256).default(""),
});
export type SettleSpendCommandData = z.infer<
  typeof settleSpendCommandDataSchema
>;
