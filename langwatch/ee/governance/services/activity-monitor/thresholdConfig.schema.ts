// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Per-rule-type Zod schemas for `AnomalyRule.thresholdConfig`. Mirrors
 * the per-tile-type config validation pattern from the Phase 7 aiTools
 * router (`aiToolEntry.service.ts:5a3219ae0`).
 *
 * Why this exists: `thresholdConfig` is stored as `Json` and the router
 * input was `z.record(z.string(), z.unknown())` — any shape persisted.
 * Bad configs (typos, wrong types, snake_case keys) silently fell back
 * to `DEFAULT_SPEND_SPIKE_CONFIG` at evaluation time via the lenient
 * `parseThresholdConfig` in `spendSpikeAnomalyEvaluator.service.ts:340`.
 * The admin thinks they configured ratio=5.0; the rule actually runs
 * with ratio=2.0; alerts fire on the wrong threshold.
 *
 * Strict validation at create/update + at evaluation surfaces the
 * misconfiguration where the admin can fix it. Stale rows that fail
 * strict validation are quarantined (skipped + warning logged) rather
 * than silently defaulted.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature
 */
import { z } from "zod";

export const SUPPORTED_RULE_TYPES = ["spend_spike"] as const;
export type SupportedRuleType = (typeof SUPPORTED_RULE_TYPES)[number];

export const spendSpikeThresholdConfigSchema = z.object({
  windowSec: z
    .number()
    .int()
    .positive({ message: "windowSec must be a positive integer" }),
  ratioVsBaseline: z
    .number()
    .positive({ message: "ratioVsBaseline must be positive" }),
  minBaselineUsd: z
    .number()
    .nonnegative({ message: "minBaselineUsd cannot be negative" }),
});

export type SpendSpikeThresholdConfigParsed = z.infer<
  typeof spendSpikeThresholdConfigSchema
>;

/**
 * Validate a `thresholdConfig` payload against the schema for the
 * named `ruleType`. Throws ZodError on shape failure; throws a generic
 * Error on unknown ruleType (callers should translate that to
 * BAD_REQUEST at the router layer).
 */
export function validateThresholdConfig({
  ruleType,
  config,
}: {
  ruleType: string;
  config: unknown;
}): SpendSpikeThresholdConfigParsed {
  if (!SUPPORTED_RULE_TYPES.includes(ruleType as SupportedRuleType)) {
    throw new Error(
      `Unsupported ruleType "${ruleType}". Supported: ${SUPPORTED_RULE_TYPES.join(", ")}.`,
    );
  }
  // Discriminator dispatch — single ruleType today, ready for more.
  switch (ruleType as SupportedRuleType) {
    case "spend_spike":
      return spendSpikeThresholdConfigSchema.parse(config);
  }
}

/**
 * Same as `validateThresholdConfig` but returns the parsed value via a
 * SafeParse-style result so the evaluator can quarantine stale rows
 * without throwing. Used by `spendSpikeAnomalyEvaluator.service.ts` to
 * skip-with-warning instead of crashing on legacy rows that pre-date
 * the strict schema.
 */
export function safeParseSpendSpikeThresholdConfig(
  config: unknown,
):
  | { ok: true; data: SpendSpikeThresholdConfigParsed }
  | { ok: false; error: z.ZodError } {
  const result = spendSpikeThresholdConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error };
}
