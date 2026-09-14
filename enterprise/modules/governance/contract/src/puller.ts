import { z } from "zod";
import { PULLED_USAGE_COST_BASIS, PULLED_USAGE_COST_STATUS } from "./pulled-usage.events.ts";

const COST_USD_PATTERN = /^[+-]?\d*(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
const costUsdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const candidate = String(value).trim();
    if (candidate === "" || candidate === "0" || candidate === "0.0") return "0";
    if (!COST_USD_PATTERN.test(candidate)) return "0";
    const numeric = Number(candidate);
    // Signed: a provider that credits a period reports the credit in the
    // same field a charge arrives in, and clamping it to zero leaves the
    // charge it reverses standing alone. The finite check still catches
    // "-" and "-1e999", which match the pattern and are not money.
    return Number.isFinite(numeric) ? candidate : "0";
  })
  .default("0");

export const normalizedPullEventSchema = z
  .object({
    source_event_id: z.string(),
    event_timestamp: z.string(),
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    cost_usd: costUsdSchema,
    /** The provider's billed amount, named by cost_currency beside it. */
    cost_amount: z.string().optional(),
    /** ISO 4217 code for cost_amount. Absent means dollars. */
    cost_currency: z.string().length(3).optional(),
    tokens_input: z.number().nonnegative().int().default(0),
    tokens_output: z.number().nonnegative().int().default(0),
    raw_payload: z.string(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type NormalizedPullEvent = z.infer<typeof normalizedPullEventSchema>;
export type PullResult = {
  events: NormalizedPullEvent[];
  cursor: string | null;
  errorCount: number;
};
export type PullRunOptions = {
  cursor: string | null;
  credentials?: Record<string, string>;
  context?: { organizationId: string; ingestionSourceId: string };
  deadlineMs?: number;
  signal?: AbortSignal;
};

export abstract class GovernancePuller<Configuration = unknown> {
  abstract readonly id: string;
  abstract validateConfig(config: unknown): Configuration;
  abstract runOnce(options: PullRunOptions, config: Configuration): Promise<PullResult>;
}

export const ANTHROPIC_ADMIN_ADAPTER_ID = "anthropic_admin" as const;
/**
 * NOT .strict()—the object carries encrypted credentials that validateConfig handles.
 * A strict schema would reject them as unrecognized_keys on every run.
 */
export const anthropicAdminPullConfigSchema = z.object({
  adapter: z.literal(ANTHROPIC_ADMIN_ADAPTER_ID),
  /**
   * Which report this source pulls. Deliberately not a set: pulling both
   * would report the same spend twice under different bases, and nothing
   * reconciles them yet.
   */
  report: z.enum(["usage", "cost"]),
  /** Anthropic's bucket granularity. It is part of the restatement key. */
  bucketWidth: z.enum(["1m", "1h", "1d"]).default("1d"),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("0 * * * *"),
});
export type AnthropicAdminPullConfig = z.infer<typeof anthropicAdminPullConfigSchema>;

export const OPENAI_ADMIN_ADAPTER_ID = "openai_admin" as const;
/**
 * Beside its Anthropic sibling, and for the same reason: nothing validates a
 * pullConfig at save time, so the composer that writes one and the puller that
 * reads it have to agree, and a test can only check that if both can name the
 * schema. Not `.strict()`, for the reason given above it.
 */
export const openaiAdminPullConfigSchema = z.object({
  adapter: z.literal(OPENAI_ADMIN_ADAPTER_ID),
  /**
   * A single-value enum rather than a bare constant, so a second report could
   * be added later without re-keying the rows this one wrote — `report` rides
   * the restatement key.
   */
  report: z.enum(["cost"]).default("cost"),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("0 * * * *"),
});
export type OpenAiAdminPullConfig = z.infer<typeof openaiAdminPullConfigSchema>;

export const PULLED_USAGE_HINT_KEY = "pulled_usage" as const;

export const pulledUsageHintSchema = z
  .object({
    costBasis: z.enum([
      PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
      PULLED_USAGE_COST_BASIS.COMPUTED,
    ]),
    costStatus: z
      .enum([PULLED_USAGE_COST_STATUS.EXACT, PULLED_USAGE_COST_STATUS.ESTIMATE])
      .optional(),
    dimensions: z
      .record(z.string(), z.string())
      .refine((dimensions) => Object.keys(dimensions).length > 0, {
        message: "a pulled usage hint must name at least one dimension to key on",
      }),
    costUsd: z.string().optional(),
    /**
     * Which currency costUsd is in, ISO 4217. Absent means dollars.
     * Deliberately NOT a dimension: dimensions are the restatement
     * identity, so a re-denominated period would mint a fresh key and
     * add its correction beside the figure it corrects.
     */
    currency: z.string().length(3).optional(),
    /**
     * The BILLER's own conversion of costUsd into dollars, as the exact
     * decimal string it published. Absent stays absent - nothing fills
     * it from a rate of ours. Not a dimension, same reason as above.
     */
    costUsdBiller: z.string().optional(),
    model: z.string().optional(),
    tokensCacheRead: z.number().int().nonnegative().default(0),
    tokensCacheWrite: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((hint, context) => {
    if (hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED && !hint.costStatus) {
      context.addIssue({
        code: "custom",
        path: ["costStatus"],
        message:
          "a provider-reported cost must declare costStatus: only the adapter knows whether the provider's figure is the invoice or an approximation of one",
      });
    }
  });
export type PulledUsageHint = z.infer<typeof pulledUsageHintSchema>;

export const pulledUsageSourceAttributionSchema = z
  .object({
    ingestionSourceId: z.string().min(1),
    sourceType: z.string().min(1),
    organizationId: z.string().min(1),
    teamId: z.string().min(1).nullable(),
  })
  .strict();
export type PulledUsageSourceAttribution = z.infer<typeof pulledUsageSourceAttributionSchema>;
