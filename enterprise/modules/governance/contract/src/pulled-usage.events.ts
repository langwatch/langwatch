import { z } from "zod";

import { governanceEventEnvelopeSchema } from "./governance.ts";

export const PULLED_USAGE_PIPELINE_NAME = "pulled_usage_processing" as const;
export const PULLED_USAGE_AGGREGATE_TYPE = "pulled_usage" as const;
export const PULLED_USAGE_EVENT_TYPES = {
  OBSERVED: "lw.obs.pulled_usage.observed",
  /**
   * Withdraws what one restatement key holds in its cell — a provider
   * reissuing a charge under an excluded dimension lands in a different cell
   * and can double the day's total unless this fires.
   */
  RETRACTED: "lw.obs.pulled_usage.retracted",
} as const;
export const PULLED_USAGE_PROCESSING_EVENT_TYPES = Object.values(PULLED_USAGE_EVENT_TYPES);
export const PULLED_USAGE_EVENT_VERSIONS = {
  OBSERVED: "2026-08-06",
  RETRACTED: "2026-09-09",
} as const;
export const PULLED_USAGE_COST_BASIS = {
  PROVIDER_REPORTED: "provider_reported",
  COMPUTED: "computed",
} as const;
export const PULLED_USAGE_COST_STATUS = {
  EXACT: "exact",
  ESTIMATE: "estimate",
} as const;
/**
 * Currency every pulled-usage producer reported before money carried one.
 * One constant, not a literal, so the schema default, pricing fallback and
 * legacy read can't quietly disagree.
 */
export const PULLED_USAGE_DEFAULT_CURRENCY_CODE = "USD" as const;

export const pulledUsageCostBasisSchema = z.enum(PULLED_USAGE_COST_BASIS);
export const pulledUsageCostStatusSchema = z.enum(PULLED_USAGE_COST_STATUS);

export const pulledUsageObservedEventDataSchema = z
  .object({
    itemKey: z.string().min(1),
    restatementKey: z.string().min(1),
    source: z.string().min(1),
    ingestionSourceId: z.string().min(1),
    organizationId: z.string().min(1),
    teamId: z.string().nullable(),
    projectId: z.string().nullable(),
    model: z.string(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    tokensCacheRead: z.number().int().nonnegative(),
    tokensCacheWrite: z.number().int().nonnegative(),
    /**
     * Cost in integer MINOR units, priced once at ingest, SIGNED (unlike token counts).
     * Providers refund/credit as negatives; they must reach the ledger or charges stand alone.
     */
    costNanoMinor: z.number().int(),
    /**
     * Currency code, ISO 4217. Defaulted to dollars because old log entries lack it;
     * making it required would break append-only log (rebuild, not migration per ADR-128).
     */
    currencyCode: z.string().length(3).default(PULLED_USAGE_DEFAULT_CURRENCY_CODE),
    /**
     * Biller's conversion of costNanoMinor to nano-dollars. Null means money we can't
     * honestly state in dollars (different from zero, which is free). Never invents rates.
     */
    costNanoUsd: z.number().int().nullable().default(null),
    rateVersion: z.string().nullable(),
    costBasis: pulledUsageCostBasisSchema,
    costStatus: pulledUsageCostStatusSchema,
    /**
     * The provider's raw id for who spent, or `""` when it named nobody or the day is pre-line
     * (ADR-129). Defaulted like `currencyCode`: events already on the log carry no spender.
     */
    rawActorId: z.string().default(""),
    /** The agent within the source (a Genie space), or `""` (#7881); keyed like the spender. */
    agentId: z.string().default(""),
    occurredAtMs: z.number().int().positive(),
    observedAtMs: z.number().int().positive(),
  })
  .strict();

export const pulledUsageObservedEventSchema = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(PULLED_USAGE_AGGREGATE_TYPE),
  type: z.literal(PULLED_USAGE_EVENT_TYPES.OBSERVED),
  version: z.literal(PULLED_USAGE_EVENT_VERSIONS.OBSERVED),
  data: pulledUsageObservedEventDataSchema,
});

/**
 * `PulledUsageRetracted` withdraws what one restatement key holds in its
 * cell (challenge settlement 9). `costNanoMinor` is zero rather than omitted
 * because `readPulledUsageMoney` falls back to `costNanoUsd` when absent.
 */
export const pulledUsageRetractedEventDataSchema = z
  .object({
    /** The dimension-only identity of the item being withdrawn. */
    restatementKey: z.string().min(1),
    /** Which provider record this came from, e.g. `anthropic_admin`. */
    source: z.string().min(1),
    /** The ingestion source's id — the row that owns the attribution. */
    ingestionSourceId: z.string().min(1),
    organizationId: z.string().min(1),
    model: z.string(),

    /** Zero, always. See the header for why it is stated rather than omitted. */
    costNanoMinor: z.number().int(),
    /** The currency of the cell being retracted — part of that cell's address. */
    currencyCode: z.string().length(3),
    costNanoUsd: z.number().int().nullable().default(null),
    /**
     * The spender of the cell being retracted — part of that cell's address.
     * `""` when the cell was filed under no named spender, stated rather than
     * defaulted.
     */
    rawActorId: z.string(),
    /**
     * The agent of the cell being retracted — part of that cell's address.
     * `""` when the cell was filed under no named agent, stated rather than
     * defaulted.
     */
    agentId: z.string(),

    /** The business bucket of the day this CORRECTS, epoch ms. */
    occurredAtMs: z.number().int().positive(),
    /** When the correction was pulled, epoch ms. The ordering field. */
    observedAtMs: z.number().int().positive(),
  })
  .strict();

export const pulledUsageRetractedEventSchema = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(PULLED_USAGE_AGGREGATE_TYPE),
  type: z.literal(PULLED_USAGE_EVENT_TYPES.RETRACTED),
  version: z.literal(PULLED_USAGE_EVENT_VERSIONS.RETRACTED),
  data: pulledUsageRetractedEventDataSchema,
});

/**
 * Translates old events' costNanoUsd (the amount) to costNanoMinor, since this build
 * reuses costNanoUsd for the biller's dollar conversion. Read path parses data directly;
 * log is append-only. Legacy entries all reported dollars, making the fallback correct.
 */
export function readPulledUsageMoney(data: {
  costNanoMinor?: number;
  currencyCode?: string;
  costNanoUsd?: number | null;
}): {
  costNanoMinor: number;
  currencyCode: string;
  costNanoUsd: number | null;
} {
  if (typeof data.costNanoMinor === "number") {
    return {
      costNanoMinor: data.costNanoMinor,
      currencyCode: data.currencyCode ?? PULLED_USAGE_DEFAULT_CURRENCY_CODE,
      costNanoUsd: data.costNanoUsd ?? null,
    };
  }
  return {
    // A legacy event: its `costNanoUsd` IS the amount, in dollars, and there
    // is no separate biller conversion to carry.
    costNanoMinor: data.costNanoUsd ?? 0,
    currencyCode: PULLED_USAGE_DEFAULT_CURRENCY_CODE,
    costNanoUsd: null,
  };
}

export type PulledUsageCostBasis = z.infer<typeof pulledUsageCostBasisSchema>;
export type PulledUsageCostStatus = z.infer<typeof pulledUsageCostStatusSchema>;
export type PulledUsageObservedEventData = z.infer<typeof pulledUsageObservedEventDataSchema>;
export type PulledUsageObservedEvent = z.infer<typeof pulledUsageObservedEventSchema>;
export type PulledUsageRetractedEventData = z.infer<typeof pulledUsageRetractedEventDataSchema>;
export type PulledUsageRetractedEvent = z.infer<typeof pulledUsageRetractedEventSchema>;
