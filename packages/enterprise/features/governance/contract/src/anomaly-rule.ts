import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";
import { unsupportedGovernanceValue } from "./governance.errors";

export const ANOMALY_RULE_SEVERITIES = [
  "critical",
  "warning",
  "info",
] as const;
export const ANOMALY_RULE_SCOPES = [
  "organization",
  "team",
  "project",
  "source_type",
  "source",
] as const;
export const ANOMALY_RULE_STATUSES = ["active", "disabled"] as const;

export const anomalyRuleSeveritySchema = z.enum(ANOMALY_RULE_SEVERITIES);
export const anomalyRuleScopeSchema = z.enum(ANOMALY_RULE_SCOPES);
export const anomalyRuleStatusSchema = z.enum(ANOMALY_RULE_STATUSES);

export type AnomalyRuleSeverity = z.infer<typeof anomalyRuleSeveritySchema>;
export type AnomalyRuleScope = z.infer<typeof anomalyRuleScopeSchema>;
export type AnomalyRuleStatus = z.infer<typeof anomalyRuleStatusSchema>;

export const anomalyRuleSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  scope: anomalyRuleScopeSchema,
  scopeId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  severity: anomalyRuleSeveritySchema,
  ruleType: z.string(),
  thresholdConfig: z.record(z.string(), z.unknown()),
  destinationConfig: z.record(z.string(), z.unknown()),
  status: anomalyRuleStatusSchema,
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdById: z.string().nullable(),
});
export type AnomalyRule = z.infer<typeof anomalyRuleSchema>;

export const createAnomalyRuleInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().nullable().optional(),
  severity: anomalyRuleSeveritySchema,
  ruleType: z.string().min(1).max(64),
  scope: anomalyRuleScopeSchema,
  scopeId: z.string().min(1),
  thresholdConfig: z.record(z.string(), z.unknown()).optional(),
  destinationConfig: z.record(z.string(), z.unknown()).optional(),
  status: anomalyRuleStatusSchema.optional(),
  actorUserId: z.string(),
});
export type CreateAnomalyRuleInput = z.infer<
  typeof createAnomalyRuleInputSchema
>;

export const updateAnomalyRuleInputSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  severity: anomalyRuleSeveritySchema.optional(),
  ruleType: z.string().min(1).max(64).optional(),
  scope: anomalyRuleScopeSchema.optional(),
  scopeId: z.string().min(1).optional(),
  thresholdConfig: z.record(z.string(), z.unknown()).optional(),
  destinationConfig: z.record(z.string(), z.unknown()).optional(),
  status: anomalyRuleStatusSchema.optional(),
});
export type UpdateAnomalyRuleInput = z.infer<
  typeof updateAnomalyRuleInputSchema
>;

export class AnomalyRuleNotFoundError extends NotFoundError {
  constructor(ruleId: string) {
    super("anomaly_rule_not_found", "Anomaly rule", ruleId);
    this.name = "AnomalyRuleNotFoundError";
  }
}

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

export const DEFAULT_SPEND_SPIKE_CONFIG: SpendSpikeThresholdConfig = {
  windowSec: 3600,
  ratioVsBaseline: 2,
  minBaselineUsd: 1,
};

export const spendSpikeDecisionSchema = z.enum([
  "fire",
  "skip_below_baseline",
  "skip_below_threshold",
  "skip_dedup",
  "skip_no_data",
  "skip_invalid_config",
]);
export type SpendSpikeDecision = z.infer<typeof spendSpikeDecisionSchema>;

export const spendSpikeEvaluationInputSchema = z.object({
  ruleId: z.string(),
  organizationId: z.string(),
  config: spendSpikeThresholdConfigSchema,
  currentSpendUsd: z.number(),
  baselineSpendUsd: z.number(),
  hasOpenAlertInWindow: z.boolean(),
  windowStart: z.date(),
  windowEnd: z.date(),
});
export type SpendSpikeEvaluationInput = z.infer<
  typeof spendSpikeEvaluationInputSchema
>;

export const spendSpikeEvaluationResultSchema = z.object({
  ruleId: z.string(),
  organizationId: z.string(),
  decision: spendSpikeDecisionSchema,
  reason: z.string(),
  currentSpendUsd: z.number(),
  baselineSpendUsd: z.number(),
  windowStart: z.date(),
  windowEnd: z.date(),
});
export type SpendSpikeEvaluationResult = z.infer<
  typeof spendSpikeEvaluationResultSchema
>;

export const anomalyAlertDispatchRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  ruleType: z.string(),
  severity: z.string(),
  organizationId: z.string(),
  destinationConfig: z.record(z.string(), z.unknown()),
});
export type AnomalyAlertDispatchRule = z.infer<
  typeof anomalyAlertDispatchRuleSchema
>;

export const anomalyAlertDispatchRecordSchema = z.object({
  id: z.string(),
  triggerWindowStart: z.date(),
  triggerWindowEnd: z.date(),
  triggerSpendUsd: z.string().nullable(),
  triggerEventCount: z.number().int().nullable(),
  detail: z.unknown(),
  detectedAt: z.date(),
});
export type AnomalyAlertDispatchRecord = z.infer<
  typeof anomalyAlertDispatchRecordSchema
>;

export const anomalyAlertDispatchInputSchema = z.object({
  rule: anomalyAlertDispatchRuleSchema,
  alert: anomalyAlertDispatchRecordSchema,
});
export type AnomalyAlertDispatchInput = z.infer<
  typeof anomalyAlertDispatchInputSchema
>;

export const anomalyAlertDispatchOutcomeSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      destinationIndex: z.number().int().nonnegative(),
      type: z.literal("webhook"),
      status: z.literal("succeeded"),
    }),
    z.object({
      destinationIndex: z.number().int().nonnegative(),
      type: z.literal("webhook"),
      status: z.literal("failed"),
      reason: z.string(),
    }),
  ],
);
export type AnomalyAlertDispatchOutcome = z.infer<
  typeof anomalyAlertDispatchOutcomeSchema
>;

export const anomalyAlertDispatchResultSchema = z.object({
  dispatchTag: z.string(),
  outcomes: z.array(anomalyAlertDispatchOutcomeSchema),
});
export type AnomalyAlertDispatchResult = z.infer<
  typeof anomalyAlertDispatchResultSchema
>;

export function evaluateSpendSpike(
  input: SpendSpikeEvaluationInput,
): SpendSpikeEvaluationResult {
  const base = {
    ruleId: input.ruleId,
    organizationId: input.organizationId,
    currentSpendUsd: input.currentSpendUsd,
    baselineSpendUsd: input.baselineSpendUsd,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };

  if (input.hasOpenAlertInWindow) {
    return {
      ...base,
      decision: "skip_dedup",
      reason:
        "Existing open alert for this rule covers the current window — not re-firing.",
    };
  }

  if (input.baselineSpendUsd < input.config.minBaselineUsd) {
    return {
      ...base,
      decision: "skip_below_baseline",
      reason: `Baseline ${input.baselineSpendUsd.toFixed(4)} USD < minBaselineUsd ${input.config.minBaselineUsd} — signal too small to trigger.`,
    };
  }

  const threshold = input.baselineSpendUsd * input.config.ratioVsBaseline;
  if (input.currentSpendUsd < threshold) {
    return {
      ...base,
      decision: "skip_below_threshold",
      reason: `Current ${input.currentSpendUsd.toFixed(4)} USD < threshold ${threshold.toFixed(4)} USD (baseline ${input.baselineSpendUsd.toFixed(4)} × ratio ${input.config.ratioVsBaseline}).`,
    };
  }

  return {
    ...base,
    decision: "fire",
    reason: `Current ${input.currentSpendUsd.toFixed(4)} USD ≥ threshold ${threshold.toFixed(4)} USD (baseline ${input.baselineSpendUsd.toFixed(4)} × ratio ${input.config.ratioVsBaseline}).`,
  };
}
