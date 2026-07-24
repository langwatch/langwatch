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

/**
 * Rule types with a wired detector / evaluator. Only these run on the
 * anomaly reactor today; others save in "preview" mode (admin can
 * persist the row, but no detection fires until the corresponding
 * evaluator ships).
 */
export const SUPPORTED_RULE_TYPES = ["spend_spike"] as const;
export type SupportedRuleType = (typeof SUPPORTED_RULE_TYPES)[number];

/**
 * Rule types the admin UI lets you compose. Including a type here
 * promises only "save will succeed" — the actual detection only fires
 * for `SUPPORTED_RULE_TYPES`. Keeping this list small + explicit
 * forces the contract to be deliberate rather than letting any
 * arbitrary string land in the `ruleType` column.
 *
 * Adding a detector flow:
 *   1. Implement the evaluator service (mirror SpendSpikeAnomalyEvaluator)
 *   2. Wire it into the anomaly reactor's switchboard
 *   3. Add the type to SUPPORTED_RULE_TYPES above
 *   4. Add a Zod schema branch in `validateThresholdConfig`
 */
export const ALLOWED_RULE_TYPES = [
  "spend_spike",
  "rate_limit",
  "after_hours",
  "model_drift",
  "error_rate",
] as const;
export type AllowedRuleType = (typeof ALLOWED_RULE_TYPES)[number];

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
}): SpendSpikeThresholdConfigParsed | null {
  // Reject genuinely unknown types — saves the admin from a typo
  // landing as a forever-dead rule.
  if (!ALLOWED_RULE_TYPES.includes(ruleType as AllowedRuleType)) {
    throw new Error(
      `Unsupported ruleType "${ruleType}". Allowed: ${ALLOWED_RULE_TYPES.join(", ")}.`,
    );
  }
  // Allowed but not yet detected — preview mode. Admin can save the
  // rule, the UI's ThresholdPreview surfaces "Won't fire" honestly,
  // and when the detector ships the rule starts firing without an
  // edit. No config validation since we have no schema to validate
  // against until the detector lands.
  if (!SUPPORTED_RULE_TYPES.includes(ruleType as SupportedRuleType)) {
    return null;
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
