Feature: AI Gateway Governance — AnomalyRule.thresholdConfig structured schema
  As an admin configuring anomaly rules
  I want bad threshold configs rejected at create/update time with a clear error
  So that misconfigurations surface during admin work, not as silent
  fall-back-to-defaults at evaluation time when the rule fails to fire

  Today, `thresholdConfig` is stored as `Json` and the router accepts
  `z.record(z.string(), z.unknown())` — any shape persists. The
  `spendSpikeAnomalyEvaluator` service at evaluation time runs a
  lenient `parseThresholdConfig` that silently substitutes
  `DEFAULT_SPEND_SPIKE_CONFIG` for missing/invalid fields, so a typo
  in the admin UI ("ratio_vs_baseline" instead of "ratioVsBaseline")
  results in the rule running with default ratio=2.0 — admin thinks
  they configured ratio=5.0 and is surprised when alerts fire on a
  smaller spike.

  This spec pins per-rule-type Zod validation at the create/update
  boundary, mirroring the per-type config validation pattern from the
  Phase 7 aiTools router (`aiToolEntry.service.ts:5a3219ae0`).

  How a rejection reaches the admin (ADR-045): every refusal below is a
  `ValidationError` — HTTP 422, code `validation_error` — not a bare
  BAD_REQUEST. The wire message is the code slug, so the sentence the admin
  reads comes from the client presentation registry keyed by that code, and
  the specific complaint (which field, which values are allowed) travels in
  `meta.formErrors`, which that registry entry renders verbatim.

  Background:
    Given organization "acme" exists on an Enterprise plan
    And alice is an org ADMIN of "acme" with `anomalyRules:manage`

  # ============================================================================
  # Valid configs round-trip
  # ============================================================================

  @bdd @integration @phase-2c @threshold-schema @valid
  Scenario: A valid spend_spike threshold config persists unchanged
    When alice calls `anomalyRules.create` with
      """
      ruleType: "spend_spike"
      thresholdConfig: { windowSec: 3600, ratioVsBaseline: 2.5, minBaselineUsd: 1.0 }
      """
    Then the response is OK
    And the persisted thresholdConfig matches the input exactly
    And the spendSpike evaluator parses it strictly without falling back to defaults

  # ============================================================================
  # Invalid configs reject as a handled validation error
  # ============================================================================

  @bdd @integration @phase-2c @threshold-schema @invalid
  Scenario Outline: Invalid spend_spike configs are rejected as validation errors
    When alice calls `anomalyRules.create` with
      """
      ruleType: "spend_spike"
      thresholdConfig: <invalid_config>
      """
    Then the response is a handled `validation_error` with HTTP status 422
    And `meta.formErrors` names the offending config and the Zod complaints
    And no AnomalyRule row is created

    Examples:
      | invalid_config                                                    | reason                            |
      | {}                                                                | missing required fields           |
      | { windowSec: -1, ratioVsBaseline: 2.0, minBaselineUsd: 1.0 }      | windowSec must be positive        |
      | { windowSec: 3600, ratioVsBaseline: 0, minBaselineUsd: 1.0 }      | ratioVsBaseline must be positive  |
      | { windowSec: 3600, ratioVsBaseline: 2.0, minBaselineUsd: -1.0 }   | minBaselineUsd cannot be negative |
      | { windowSec: "3600", ratioVsBaseline: 2.0, minBaselineUsd: 1.0 }  | windowSec must be a number        |
      | { ratio_vs_baseline: 2.5, ... }                                   | snake_case typo (legit user error)|

  # ============================================================================
  # Unknown rule type
  # ============================================================================

  # The complaint does NOT ride on the wire message — that is the code slug.
  # It rides in `meta.formErrors`, because `ruleType` is not a field name the
  # presentation registry knows how to say, so the alternative is the
  # anonymous "Some of the values aren't valid."
  @bdd @integration @phase-2c @threshold-schema @unknown-rule
  Scenario: Unknown ruleType is rejected as a validation error listing the allowed types
    When alice calls `anomalyRules.create` with `ruleType: "future_rule_type"`
    Then the response is a handled `validation_error` with HTTP status 422
    And `meta.formErrors` lists the allowed ruleTypes
    And no AnomalyRule row is created

  # ============================================================================
  # Update path also validates
  # ============================================================================

  @bdd @integration @phase-2c @threshold-schema @update
  Scenario: Updating an existing rule with an invalid thresholdConfig is rejected
    Given alice has created a valid spend_spike rule "rule_id_1"
    When alice calls `anomalyRules.update({ id: "rule_id_1", thresholdConfig: { windowSec: -1, ... } })`
    Then the response is a handled `validation_error` with HTTP status 422
    And the existing rule's thresholdConfig is unchanged

  @bdd @integration @phase-2c @threshold-schema @update
  Scenario: Updating ruleType requires a matching thresholdConfig
    Given alice has a rule with `ruleType: "spend_spike"` and a valid spend_spike config
    When alice calls `anomalyRules.update({ id, ruleType: "future_rule_type" })` without supplying a matching config
    Then the response is a handled `validation_error` with HTTP status 422
    And `meta.formErrors` names the unsupported ruleType
    And the rule is unchanged

  # ============================================================================
  # Evaluator path: stale rows are quarantined, not silently defaulted
  # ============================================================================

  @bdd @integration @phase-2c @threshold-schema @evaluator
  Scenario: Stale row that fails strict validation logs a warning and skips
    Given a legacy AnomalyRule row exists with `thresholdConfig` from before this
      schema landed: `{ ratio_vs_baseline: 2.5, window_sec: 3600 }` (snake_case)
    When the spendSpikeAnomalyEvaluator runs against that rule
    Then the rule is skipped (no AnomalyAlert is created)
    And a warning is logged with the rule id + the validation error
    And the evaluator does NOT silently substitute DEFAULT_SPEND_SPIKE_CONFIG
      and fire on the wrong threshold
    # Stale rows can be repaired via update (which re-runs validation) or
    # archived; the evaluator no longer hides the problem.
