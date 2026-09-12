import { z } from "zod";
import { governanceEventEnvelopeSchema } from "./governance.ts";

export const PULLED_USAGE_PIPELINE_NAME = "pulled_usage_processing" as const;
export const PULLED_USAGE_AGGREGATE_TYPE = "pulled_usage" as const;
export const PULLED_USAGE_EVENT_TYPES = {
  OBSERVED: "lw.obs.pulled_usage.observed",
} as const;
export const PULLED_USAGE_PROCESSING_EVENT_TYPES = Object.values(PULLED_USAGE_EVENT_TYPES);
export const PULLED_USAGE_EVENT_VERSIONS = { OBSERVED: "2026-08-06" } as const;
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
     * The money, priced exactly once at the ingest seam, as an integer of the
     * provider's own MINOR units — nano-euros for a subscription billed in
     * euros, nano-dollars for one billed in dollars. Which of those it is, is
     * `currencyCode` below and nowhere else; nothing here converts.
     *
     * SIGNED, unlike the token counts above. A provider that refunds or credits
     * a period reports it as a negative figure in the same field a charge
     * arrives in, and the credit has to reach the ledger or the charge it
     * reverses stands alone. A negative token count, by contrast, is not
     * something that happened, so those stay nonnegative.
     */
    costNanoMinor: z.number().int(),
    /**
     * Which currency `costNanoMinor` is denominated in, ISO 4217.
     *
     * Defaulted rather than required, and the default is load-bearing: every
     * event already on the durable log was written before money carried a
     * currency, and every one of those producers reported dollars. A required
     * field here would make the append-only log unreadable, which is a rebuild
     * rather than a migration (ADR-128 §3).
     */
    currencyCode: z.string().length(3).default(PULLED_USAGE_DEFAULT_CURRENCY_CODE),
    /**
     * The BILLER's own conversion of `costNanoMinor` into nano-dollars, when it
     * published one — Azure returns `totalCostUSD` beside `totalCost` at its own
     * invoice-grade rate.
     *
     * Null means no dollar figure exists for this item, and that is a different
     * fact from zero: zero charts as free usage, absent says we hold money here
     * that no dollar column can honestly state. We never invent a rate to fill
     * it, so it stays null for a non-dollar provider that published none. Null
     * on a dollars-denominated item too, where `costNanoMinor` already IS the
     * dollar figure and a copy would be a second number to keep in step.
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
 * The money on one observation, whether or not it predates currencies.
 *
 * Events already on the durable log name the money `costNanoUsd` and mean
 * "the amount", full stop. This build names the amount `costNanoMinor` and
 * reuses `costNanoUsd` for something else entirely — the BILLER's own dollar
 * conversion — so the rename cannot be read literally: a legacy event's money
 * would be taken for a conversion of an amount that is not there, leaving the
 * amount `undefined` and every total downstream `NaN`.
 *
 * That matters because nothing on the read path parses these events: the fold
 * and the drift comparator both read the data object directly, so a rebuild or
 * a re-derivation over history goes through here rather than through the
 * schema above. The log is append-only and nothing rewrites it, so this is
 * permanent rather than a migration window.
 *
 * Every producer that predates the currency field reported dollars, which is
 * what makes the fallback correct rather than a guess.
 *
 * The `costNanoMinor` test is the guard on the guard: the legacy translation
 * fires ONLY when the amount is missing, or an event this build wrote would
 * have its real biller conversion overwritten by the amount it converts.
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
