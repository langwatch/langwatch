import { z } from "zod";
import { governanceEventEnvelopeSchema } from "./governance.ts";

export const PULLED_USAGE_PIPELINE_NAME = "pulled_usage_processing" as const;
export const PULLED_USAGE_AGGREGATE_TYPE = "pulled_usage" as const;
export const PULLED_USAGE_EVENT_TYPES = {
  OBSERVED: "lw.obs.pulled_usage.observed",
  /**
   * Withdraws what one restatement key holds in the cell it currently sits in.
   *
   * Emitted when a provider reissues a charge under a dimension the
   * restatement key deliberately excludes -- the currency, the agent, the
   * spender it named. Those land in a DIFFERENT rollup cell, so without this
   * the first version is left behind holding its money with nothing to say it
   * was superseded, and a total across the day carries the one bill twice.
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
 * The currency every pulled-usage producer reported before money carried one.
 *
 * One constant rather than a literal repeated at each seam: the schema default,
 * the pricing fallback and the legacy read below all have to agree, and three
 * copies of `"USD"` is three chances for them to stop agreeing.
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
    occurredAtMs: z.number().int().positive(),
    observedAtMs: z.number().int().positive(),
  })
  .strict();

export const pulledUsageObservedEventSchema = governanceEventEnvelopeSchema.extend({
  aggregateType: z.literal(PULLED_USAGE_AGGREGATE_TYPE),
  type: z.literal(PULLED_USAGE_EVENT_TYPES.OBSERVED),
  version: z.literal(PULLED_USAGE_EVENT_VERSIONS.OBSERVED),
  data: pulledUsageObservedEventDataSchema,
});

/**
 * `PulledUsageRetracted` — withdraws what one restatement key holds in the
 * cell it currently sits in (challenge settlement 9).
 *
 * The restatement key deliberately excludes the currency, the agent and the
 * spender, so a provider reissuing the same charge under any of those files it
 * in a DIFFERENT rollup cell. The first version is then left behind holding
 * its money with nothing to say it was superseded, and a total across the day
 * carries the one bill twice. This is what says so.
 *
 * It carries the RETRACTED cell's dimensions, not the reissued one's: the
 * dimensions are the cell's address, so a retraction routed by the new
 * currency would empty the wrong cell and leave both versions live.
 *
 * `occurredAtMs` is the day the retraction CORRECTS, never the day the
 * correction arrived. The daily comparator re-derives a day from the events
 * falling inside it, so a retraction dated to its own arrival is never read
 * for the day it fixes, and that day is reported as drifting for as long as it
 * is kept.
 *
 * `costNanoMinor` is stated as zero rather than omitted, and that is
 * load-bearing rather than decoration. Nothing parses these events on the read
 * path: the fold and the comparator read the data object directly through
 * `readPulledUsageMoney`, which falls back to reading the amount out of
 * `costNanoUsd` in dollars when `costNanoMinor` is absent. A retraction that
 * omitted it would therefore address the DOLLAR cell and leave the euro one
 * live.
 *
 * For the same reason the three address dimensions below are REQUIRED here
 * while the observation above defaults them. That default is right there and
 * wrong here: an observation's default reads an append-only history written
 * before those fields existed, and this event type has no such history — it is
 * new, so every one of them is written by a producer that knows the answer.
 * A defaulted dimension on a retraction is not a lenient read of the past, it
 * is a wrong address in the present: it would empty the USD or the
 * blank-dimension cell and leave the cell it meant to withdraw still charged,
 * which is the double-counting this event exists to prevent.
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

export const pulledUsageRetractedEventSchema = governanceEventEnvelopeSchema.extend({
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
