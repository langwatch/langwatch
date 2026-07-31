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
  # Admin composer: the live preview answers the same way create does
  # ============================================================================
  #
  # The composer's threshold preview is the only place an admin is told what a
  # rule will do before saving it, so a disagreement with the schema above is a
  # defect on its own: it either reddens a config that saves fine (admins stop
  # trusting the preview, or "fix" a rule that was already right) or promises a
  # save that the create call then refuses. It once required a fourth key,
  # `baselineOffsetSec`, that neither the schema nor the evaluator has ever
  # read, so a config copied from the docs rendered as an error.

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview accepts the same spend_spike config the create call accepts
    Given the composer is open with ruleType "spend_spike"
    When the admin types the three keys the schema requires and nothing else
    Then the preview describes what the rule will do
    And it does not report the config as invalid
    And it does not ask for a key the rule never reads

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview describes the baseline the evaluator actually uses
    Given the composer holds a valid spend_spike config with a one-day window
    Then the preview says spend in the last day is compared against the
      average of the previous six days
    And it never describes the baseline as a fixed point in the past

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview says which threshold keys the rule ignores
    Given the composer holds a valid spend_spike config that also carries
      `baselineOffsetSec` (rules authored from the old template still do)
    Then the preview still describes what the rule will do
    And it names the key as one this rule type ignores
    # Unknown keys are stripped on read, not refused on save — the rule is
    # valid, the extra number simply never reaches it.

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview refuses the field values the create call refuses
    Given the composer is open with ruleType "spend_spike"
    When the admin types a config the schema rejects — a negative or
      fractional window, a zero ratio, a negative floor, a missing key, or
      snake_case names
    Then the preview reports it as invalid before the admin submits

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview says a saveable but unchecked rule type will not fire
    Given the admin types a rule type that is allowed but has no detector yet
    Then the preview says the rule saves but nothing checks it yet
    And it names the rule types that do fire today

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer preview refuses a rule type the create call would refuse
    Given the admin types a rule type outside the allowed list — a typo, the
      wrong case, or nothing at all
    Then the preview reports it as invalid rather than promising it saves
    And it lists the rule types the admin can choose

  @bdd @unit @phase-2c @threshold-schema @composer
  Scenario: The composer's spend_spike template is exactly what the rule reads
    When the composer pre-fills a spend_spike threshold config
    Then every key in it is one the schema keeps
    And no key is dropped when the rule is read

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
