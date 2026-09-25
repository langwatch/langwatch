import type { Instant } from "@langwatch/time";
/**
 * Spend-event filter vocabulary and row shape shared by every reader of the
 * `gateway_spend` ledger: tRPC, REST, and the repositories underneath. One
 * module owns it so the screen and a reconciliation script never diverge.
 */
import { z } from "zod";

export type SpendEventStatus = "admitted" | "confirmed" | "failed" | "settled";

/**
 * Every status a caller may narrow on. `success` and `error` are the pre-
 * pipeline spelling of `confirmed` and `failed`, kept so older clients keep
 * working.
 */
export const SPEND_STATUS_FILTERS = [
  "success",
  "error",
  "admitted",
  "confirmed",
  "failed",
  "settled",
] as const;

/** The events read's status filter: the whole vocabulary. */
export const spendStatusFilter = z.enum(SPEND_STATUS_FILTERS);

/**
 * Max values one filter may name - each becomes a bound ClickHouse array
 * element, so an unbounded repeat is an unbounded query on a billing read.
 * A caller needing more is really naming a team or organization instead.
 */
export const MAX_FILTER_VALUES = 100;

/** A metadata predicate: the caller's own key, and the values that match. */
export interface SpendMetadataFilter {
  key: string;
  /** Any of these matches. Repeating a key in the query widens it. */
  values: string[];
}

export interface SpendFilters {
  virtualKeyIds?: string[];
  endUserIds?: string[];
  principalUserIds?: string[];
  models?: string[];
  providerKeys?: string[];
  requestTypes?: string[];
  labels?: string[];
  metadata?: SpendMetadataFilter[];
  status?: string;
}

const id = z.string().min(1).max(100);
const longId = z.string().min(1).max(256);

/**
 * The structured spelling of the spend-event filter vocabulary, for a caller
 * speaking structured values rather than query strings — the tRPC surface —
 * so the Billing events screen narrows exactly the way REST reads do.
 */
export const spendFiltersSchema = z.object({
  virtualKeyIds: z.array(id).max(MAX_FILTER_VALUES).optional(),
  endUserIds: z.array(longId).max(MAX_FILTER_VALUES).optional(),
  principalUserIds: z.array(id).max(MAX_FILTER_VALUES).optional(),
  models: z.array(z.string().min(1).max(200)).max(MAX_FILTER_VALUES).optional(),
  providerKeys: z.array(id).max(MAX_FILTER_VALUES).optional(),
  requestTypes: z.array(z.string().min(1).max(50)).max(MAX_FILTER_VALUES).optional(),
  labels: z.array(z.string().min(1).max(200)).max(MAX_FILTER_VALUES).optional(),
  metadata: z
    .array(
      z.object({
        // No colon, so this spelling cannot express a key the query spelling
        // cannot. A filter the screen can set and a reconciliation script
        // cannot reproduce is the drift this whole module exists to prevent.
        key: z
          .string()
          .min(1)
          .max(128)
          .refine((raw) => !raw.includes(":"), {
            message: "a metadata key cannot contain a colon",
          }),
        // Non-empty for the same reason the query spelling is: ClickHouse
        // answers a missing Map key with the type default, so an empty value
        // matches every row that lacks the key.
        values: z.array(z.string().min(1).max(512)).min(1).max(MAX_FILTER_VALUES),
      }),
    )
    .max(MAX_FILTER_VALUES)
    .optional(),
  // The whole vocabulary, because this schema backs an EVENTS read. A rollup
  // caller narrows with the summary status filter instead.
  status: spendStatusFilter.optional(),
}) satisfies z.ZodType<SpendFilters>;

/** One spend-event row, as the ledger and its repositories carry it. */
export type SpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  /** Not carried by the command pipeline; kept for response-shape
   *  stability, always empty. */
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  /** Integer nano-USD, the authoritative figure. */
  costNanoUsd: number;
  /** Decimal USD string derived from costNanoUsd, up to 9 fractional digits. */
  costUsd: string;
  rateVersion: string;
  status: SpendEventStatus;
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  /** Why settlement fired, set only on settled rows. */
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Instant;
};

/**
 * Billing quantities: named fields (not a map, to preserve sumIf rollups and
 * per-field defaults). audio/image_tokens are disjoint from text tokens;
 * image_count/reasoning_tokens are display-only; audio_ms /1000 at rating.
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

/**
 * A confirmed outcome whose price its own caller resolved: a brokered voice
 * session or a judged query has no model in the registry, so the spine takes
 * the figure as given rather than re-rating it. @see ADR-045
 */
export interface GatewayPricedSpend {
  /** Addresses the outcome; a repeat under the same id is one event. */
  readonly requestId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly teamId: string;
  /** How the ledger, the budgets and the meters group this spend. */
  readonly requestType: string;
  readonly model: string;
  /** The stamp of the rating that produced the price. Never empty. */
  readonly rateVersion: string;
  readonly inputTokens: number;
  /** The CUSTOMER price, which is what every ledger consumer charges. */
  readonly costNanoUsd: number;
  /** JSON the row carries beside the price. Empty when there is none. */
  readonly metadata?: string;
  /** Epoch milliseconds. */
  readonly occurredAt: number;
}

/** Whether the outcome reached the spine. Unavailable on a deployment with no
 *  spend pipeline registered, which is a fact about the process, not a fault. */
export type GatewayPricedSpendResult = { status: "recorded" } | { status: "unavailable" };

/** One billing event in the canonical envelope shared by pull and webhook delivery. */
export const gatewaySpendEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type GatewaySpendEnvelope = z.infer<typeof gatewaySpendEnvelopeSchema>;

const spendEventUsageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  reasoning_tokens: z.number().int(),
  input_image_tokens: z
    .number()
    .int()
    .optional()
    .describe("Image tokens billed on the input side, disjoint from input_tokens."),
  output_image_tokens: z
    .number()
    .int()
    .optional()
    .describe("Image tokens the answer was billed for, disjoint from output_tokens."),
  image_count: z
    .number()
    .int()
    .optional()
    .describe("Images the request carried. Display only: never part of a cost sum."),
});

const spendEventCostSchema = z.object({
  total_usd: z.string().describe("Display value. Use nano_usd for arithmetic."),
  nano_usd: z.number().int().describe("Canonical integer cost, nano-USD."),
  rate_version: z.string().nullable().optional(),
});

/** The pulled billing envelope, its `data` typed as the webhooks deliver it. */
export const gatewaySpendEventEnvelopeSchema = z.object({
  ...gatewaySpendEnvelopeSchema.shape,
  data: z.looseObject({
    event_id: z.string(),
    event_type: z.string(),
    /** The join key across the settled/completed pair. */
    gateway_request_id: z.string(),
    occurred_at: z.string(),
    /** Null while quantities are unknown (admitted) or no longer authoritative (settled). */
    usage: spendEventUsageSchema.nullable(),
    cost: spendEventCostSchema.nullable(),
    status: z.string(),
    needs_reconciliation: z.boolean().nullable(),
    settle_reason: z.string().nullable(),
    error: z.object({ class: z.string(), http_status: z.number().int().nullable() }).nullable(),
    duration_ms: z.number().int().nullable(),
    labels: z.array(z.string()),
    metadata: z.record(z.string(), z.unknown()),
  }),
});
export type GatewaySpendEventEnvelope = z.infer<typeof gatewaySpendEventEnvelopeSchema>;
