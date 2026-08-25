import { z } from "zod";
import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
} from "./pulled-usage.events";

const COST_USD_PATTERN = /^[+-]?\d*(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
const costUsdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const candidate = String(value).trim();
    if (candidate === "" || candidate === "0" || candidate === "0.0")
      return "0";
    if (!COST_USD_PATTERN.test(candidate)) return "0";
    const numeric = Number(candidate);
    return Number.isFinite(numeric) && numeric >= 0 ? candidate : "0";
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
  abstract runOnce(
    options: PullRunOptions,
    config: Configuration,
  ): Promise<PullResult>;
}

export const ANTHROPIC_ADMIN_ADAPTER_ID = "anthropic_admin" as const;
export const anthropicAdminPullConfigSchema = z
  .object({
    adapter: z.literal(ANTHROPIC_ADMIN_ADAPTER_ID),
    report: z.enum(["usage", "cost"]),
    bucketWidth: z.enum(["1m", "1h", "1d"]).default("1d"),
    startingAt: z.string().datetime().optional(),
    schedule: z.string().default("0 * * * *"),
  })
  .strict();
export type AnthropicAdminPullConfig = z.infer<
  typeof anthropicAdminPullConfigSchema
>;

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
    model: z.string().optional(),
    tokensCacheRead: z.number().int().nonnegative().default(0),
    tokensCacheWrite: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((hint, context) => {
    if (
      hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED &&
      !hint.costStatus
    ) {
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
export type PulledUsageSourceAttribution = z.infer<
  typeof pulledUsageSourceAttributionSchema
>;
