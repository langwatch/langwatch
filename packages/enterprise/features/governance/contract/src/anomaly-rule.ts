import { z } from "zod";
import { unsupportedGovernanceValue } from "./governance.errors";

export const SUPPORTED_DESTINATION_TYPES = ["webhook"] as const;
export const webhookDestinationSchema = z
  .object({
    type: z.literal("webhook"),
    url: z
      .string()
      .url({ message: "url must be an absolute https URL" })
      .refine((url) => url.startsWith("https://"), {
        message: "url must use the https scheme",
      }),
    sharedSecret: z.string().min(1).max(512).optional(),
  })
  .strict();
export const anomalyDestinationSchema = z.discriminatedUnion("type", [
  webhookDestinationSchema,
]);
export const destinationConfigSchema = z
  .object({ destinations: z.array(anomalyDestinationSchema).max(10) })
  .strict();

export type SupportedDestinationType =
  (typeof SUPPORTED_DESTINATION_TYPES)[number];
export type WebhookDestination = z.infer<typeof webhookDestinationSchema>;
export type AnomalyDestination = z.infer<typeof anomalyDestinationSchema>;
export type DestinationConfig = z.infer<typeof destinationConfigSchema>;
export type Destination = AnomalyDestination;
export type DestinationConfigParsed = DestinationConfig;

export function validateDestinationConfig(config: unknown): DestinationConfig {
  return destinationConfigSchema.parse(config);
}

export function safeParseDestinationConfig(
  config: unknown,
): { ok: true; data: DestinationConfig } | { ok: false; error: z.ZodError } {
  if (
    !config ||
    (typeof config === "object" && Object.keys(config).length === 0)
  ) {
    return { ok: true, data: { destinations: [] } };
  }
  const result = destinationConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error };
}

export const SUPPORTED_RULE_TYPES = ["spend_spike"] as const;
export const ALLOWED_RULE_TYPES = [
  "spend_spike",
  "rate_limit",
  "after_hours",
  "model_drift",
  "error_rate",
] as const;
export type SupportedRuleType = (typeof SUPPORTED_RULE_TYPES)[number];
export type AllowedRuleType = (typeof ALLOWED_RULE_TYPES)[number];

export const spendSpikeThresholdConfigSchema = z
  .object({
    windowSec: z.number().int().positive(),
    ratioVsBaseline: z.number().positive(),
    minBaselineUsd: z.number().nonnegative(),
  })
  .strict();
export type SpendSpikeThresholdConfig = z.infer<
  typeof spendSpikeThresholdConfigSchema
>;
export type SpendSpikeThresholdConfigParsed = SpendSpikeThresholdConfig;

export function validateThresholdConfig(input: {
  ruleType: string;
  config: unknown;
}): SpendSpikeThresholdConfig | null {
  if (!ALLOWED_RULE_TYPES.includes(input.ruleType as AllowedRuleType)) {
    throw unsupportedGovernanceValue({
      field: "ruleType",
      value: input.ruleType,
      allowed: ALLOWED_RULE_TYPES,
    });
  }
  if (!SUPPORTED_RULE_TYPES.includes(input.ruleType as SupportedRuleType)) {
    return null;
  }
  return spendSpikeThresholdConfigSchema.parse(input.config);
}

export function safeParseSpendSpikeThresholdConfig(
  config: unknown,
):
  | { ok: true; data: SpendSpikeThresholdConfig }
  | { ok: false; error: z.ZodError } {
  const result = spendSpikeThresholdConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error };
}
