Feature: An absent evaluator score is never presented or stored as zero
  As a user who configured a custom LLM-judge evaluator
  I want my saved prompt to reach the judge on every trace, and a missing score to read as "not scored"
  So that I can trust the scores my monitors produce and tell "the judge said zero" apart from "the judge never scored this"

  # Issue: langwatch/langwatch#6397 (P1, 119-day-old support report).
  #
  # The customer reported a score of 0 on EVERY trace while the same prompt passed
  # in the playground. That discriminator is the whole issue: the playground posts
  # the prompt straight from the form, so it never has to READ the saved prompt back.
  # The online/monitor path is the only one that must recover the prompt from stored
  # config, and its read rule yields {} on config shapes nothing prevents — at which
  # point langevals applies its own strict default prompt, which scores 0.
  #
  # The langevals judge itself is exonerated: run directly it returns real scores,
  # returns status "skipped" for degenerate input, and status "error" after retries
  # on a parse failure. It never mints a zero. Every spurious zero below is minted
  # in LangWatch's own TypeScript after a correct judge response.
  #
  # THE TRAP, load-bearing for every scenario in this file: a genuine 0.0 is real
  # data — llm_boolean returns `score = 1 if passed else 0`. Every guard must
  # discriminate ABSENT from ZERO, never FALSY from TRUTHY. A fix that renders all
  # zeros as "N/A" trades one silent-wrong for another.

  # ⚠ Gherkin applies this Background to EVERY scenario in the file, including the two
  # @unit scenarios, which call pure functions and neither log in nor touch a project.
  # It cannot be scoped in Gherkin, so treat it as applying to the @integration scenarios
  # only; a @unit test binding here must not implement these steps.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Settings resolution on the online path (D6) — the reported defect
  # ============================================================================

  @integration @unimplemented
  Scenario: A prompt saved under config.settings reaches the judge
    Given a monitor backed by a custom LLM-judge evaluator
    And the evaluator's saved config carries the user's prompt nested under settings
    When the online evaluation pipeline executes the monitor for a trace
    Then the settings sent to the judge carry the user's prompt

  @integration @unimplemented
  Scenario: A prompt saved at the top level of config still reaches the judge
    Given a monitor backed by a custom LLM-judge evaluator
    And the evaluator's saved config carries the user's prompt at the top level with no settings key
    When the online evaluation pipeline executes the monitor for a trace
    Then the settings sent to the judge carry the user's prompt

  @integration @unimplemented
  Scenario: A settings-less config never reaches the judge as an empty object
    Given a monitor whose evaluator config has no settings key
    And the monitor carries no fallback parameters
    When the online evaluation pipeline executes the monitor for a trace
    Then the judge either receives the user's prompt or the run fails with a named error
    And the judge is never asked to evaluate using its own default prompt

  @integration @unimplemented
  Scenario: A config shape the online path cannot read cannot be written
    Given a custom LLM-judge evaluator is saved with its prompt at the top level of config
    When the evaluator is written through any of the supported creation and update paths
    Then the stored config is normalised so the online path resolves the user's prompt
    And this holds for the copy and replicate flows, which do not pass through the evaluator service

  @integration @unimplemented
  Scenario: The new settings resolution is active in the shipped default configuration
    Given the application is running in its shipped default configuration
    When the online evaluation pipeline executes a monitor for a trace
    Then the new settings resolution is active

  @integration @unimplemented
  Scenario: The new settings resolution can be switched off for rollback
    Given the settings-resolution change is disabled by its kill switch
    When the online evaluation pipeline executes a monitor for a trace
    Then the settings sent to the judge are the ones the previous behaviour produced

  @integration @unimplemented
  Scenario: An evaluator already stored in the unreadable shape still resolves its prompt
    Given an existing evaluator whose stored config predates normalisation and has no settings key
    When the online evaluation pipeline executes a monitor backed by that evaluator
    Then the settings sent to the judge carry the user's prompt
    And the evaluator does not begin failing on every trace

  # ⚠ The fallback SPLIT is the whole point, and one half of it is currently
  # asserted as correct by a passing test:
  # executeEvaluation.settings-resolution.unit.test.ts:122-134 pins
  # "config present but no settings key -> fall back to monitor.parameters".
  # That test must be updated to the new contract, not deleted -- deleting it
  # destroys the only evidence the old behaviour was deliberate.
  #
  # No evaluator at all still falls back to the monitor's parameters (SURVIVES).
  # An evaluator whose config merely lacks a settings key must not (INVERTED).
  #
  # Note: specs/monitors/monitor-execution-backend.feature does NOT contradict
  # this fix -- checked. Its "Backward compatibility with legacy monitors"
  # scenario is the without-evaluatorId case (the surviving half), and its
  # LangEvals call-structure table already says settings come from
  # evaluator.config.settings (what this fix enforces). Both are @unimplemented
  # and bind nothing regardless.

  @integration @unimplemented
  Scenario: The evaluator's own prompt wins over the monitor's parameters
    Given a monitor that carries evaluation parameters
    And its evaluator's saved config also carries a different prompt at the top level
    When the online evaluation pipeline executes the monitor for a trace
    Then the settings sent to the judge carry the evaluator's prompt

  @integration @unimplemented
  Scenario: A monitor with no evaluator still falls back to its own parameters
    Given a monitor that carries evaluation parameters and has no evaluator attached
    When the online evaluation pipeline executes the monitor for a trace
    Then the settings sent to the judge are the monitor's own parameters

  # ⚠ This scenario deliberately uses the TOP-LEVEL-PROMPT fixture. An assertion on the
  # correctly-configured fixture is forbidden by AC0f as evidence: its settings are unchanged
  # by construction, so it is green before and after and cannot go red. This is the only
  # fixture whose resolved settings value changes, so it is the only one that can catch
  # the model-env ripple.

  @integration @unimplemented
  Scenario: Model environment is resolved from the recovered settings
    Given a monitor whose evaluator config carries the user's prompt and chosen model at the top level with no settings key
    When the online evaluation pipeline executes the monitor for a trace
    Then the model environment is resolved for the model the user chose
    And it is not resolved from the settings the previous behaviour produced

  @integration @unimplemented
  Scenario: A recovered model naming an unconfigured provider degrades rather than erroring
    Given an existing evaluator whose stored config names a model whose provider is not configured
    When the online evaluation pipeline executes a monitor backed by that evaluator for a trace
    Then the evaluation reports a named configuration failure
    And it does not throw on every subsequent trace

  # ============================================================================
  # Try it out panel (D1) — absent versus zero at the render boundary
  # ============================================================================

  @integration @unimplemented
  Scenario: An absent score renders as not-scored for a langevals evaluator
    Given a langevals LLM-judge evaluator that declares a score in its result
    And a completed run whose score is absent
    When the Try it out panel renders the result
    Then the score cell reads "N/A"

  @integration @unimplemented
  Scenario: An absent score renders as not-scored for a workflow evaluator
    Given a custom workflow evaluator
    And a completed run whose score key is present but carries no value
    When the Try it out panel renders the result
    Then the score cell reads "N/A"

  @integration @unimplemented
  Scenario: A genuine zero from a langevals evaluator still renders as zero
    Given a langevals LLM-judge evaluator that declares a score in its result
    And a completed run whose score is exactly zero
    When the Try it out panel renders the result
    Then the score cell reads "0"

  @integration @unimplemented
  Scenario: A genuine zero from a workflow evaluator still renders as zero
    Given a custom workflow evaluator
    And a completed run whose score is exactly zero
    When the Try it out panel renders the result
    Then the score cell reads "0"

  @unit @unimplemented
  Scenario: No score value reaches the number formatter unguarded
    Given the Try it out panel source
    When the score render sites are inspected
    Then every score is formatted through the shared evaluation-score formatter
    And no score cell is gated on mere key presence

  @integration @unimplemented
  Scenario: The duplicate workflow score column is resolved
    Given a custom workflow evaluator whose run has an absent score
    When the Try it out panel renders the result
    Then every score cell shown for that run reads "N/A"
    And no score cell is left rendering a zero

  # ============================================================================
  # Evaluation execution (D2) — a non-numeric workflow score
  # ============================================================================

  @integration @unimplemented
  Scenario Outline: A non-numeric workflow score is never recorded as a processed zero
    Given a custom workflow evaluator
    And the workflow returns a successful envelope whose score is "<score>"
    When the evaluation result is produced
    Then the result carries no numeric score
    And the result status is not "processed"

    Examples:
      | score |
      |       |
      | N/A   |

  # ============================================================================
  # Batch persistence (D3) — absent versus zero at the write boundary
  # ============================================================================

  @integration @unimplemented
  Scenario Outline: A not-scored batch evaluation stores no score
    Given a dataset evaluation run that produces a "<outcome>" result
    When the batch evaluation row is persisted
    Then the stored score is empty rather than zero

    Examples:
      | outcome            |
      | skipped            |
      | error              |
      | label-only success |

  @integration @unimplemented
  Scenario: A genuine zero batch evaluation stores zero
    Given a dataset evaluation run that produces a processed result scoring exactly zero
    When the batch evaluation row is persisted
    Then the stored score is zero

  @integration @unimplemented
  Scenario: A not-scored batch evaluation stores no cost rather than a zero cost
    Given a dataset evaluation run that produces a not-scored result carrying no cost
    When the batch evaluation row is persisted
    Then the stored cost is empty rather than zero

  @integration @unimplemented
  Scenario: Passed and details are stored as absent alongside score
    Given a dataset evaluation run that produces a not-scored result
    When the batch evaluation row is persisted
    Then the stored passed value is empty rather than false
    And the stored details value is empty rather than an empty string

  # ============================================================================
  # Experiment view (D5) — the read side that would otherwise undo the write fix
  # ============================================================================

  @integration @unimplemented
  Scenario: An all-zero dataset still shows the score metric
    Given an experiment whose every processed evaluation scored exactly zero
    When the experiment results are displayed
    Then the score metric is shown
    And the displayed average is zero

  @integration @unimplemented
  Scenario: The average excludes not-scored rows from numerator and denominator
    Given an experiment with processed evaluations scoring one, not-scored, and zero
    When the experiment results are displayed
    Then the displayed average is the mean of the scored rows only

  @integration @unimplemented
  Scenario: An experiment where nothing was scored shows no numeric average
    Given an experiment whose every processed evaluation is not-scored
    When the experiment results are displayed
    Then no numeric average is displayed
    And the view does not display a not-a-number value

  @integration @unimplemented
  Scenario: A not-scored row renders neutrally rather than as a red zero
    Given an experiment group containing one row scoring zero point eight and one not-scored row
    When the experiment results are displayed
    Then the not-scored row shows the not-scored indicator rather than a numeric score
    And the not-scored row is coloured neither as a failure nor as a pass

  @integration @unimplemented
  Scenario: A processed row with no pass verdict does not render as a red failure
    Given an experiment group in which no row carries a numeric score
    And one processed row in that group has no pass verdict
    When the experiment results are displayed
    Then that row shows the not-scored indicator rather than a failure verdict
    And that row is coloured neither as a failure nor as a pass

  # ============================================================================
  # Enumeration completeness (D7) — sites the original five-site list missed
  # ============================================================================

  @integration @unimplemented
  Scenario: An experiment summary with no scored rows shows no score rather than zero
    Given an experiment summary whose average score is not available
    When the summary line is rendered
    Then it shows the not-scored indicator rather than a numeric zero

  @integration @unimplemented
  Scenario: A not-scored summary card is coloured neither as a failure nor as a pass
    Given an experiment summary card for an evaluation with no numeric score
    When the card is rendered
    Then the card is coloured neither as a failure nor as a pass

  @integration @unimplemented
  Scenario: A best score that has not loaded yet is not shown as zero
    Given an optimization run whose steps have not loaded
    When the best score is rendered
    Then it shows the not-scored indicator rather than a numeric zero

  # ============================================================================
  # Regression and ripple
  # ============================================================================

  @unit
  Scenario Outline: The shared score formatter distinguishes absent from zero
    Given a score value of "<value>"
    When it is formatted for display
    Then the formatted result is "<rendered>"

    Examples:
      | value     | rendered |
      | absent    | N/A      |
      | empty     | N/A      |
      | zero      | 0        |

  @integration @unimplemented
  Scenario: A correctly configured monitor is unaffected
    Given a monitor whose evaluator config already carries the user's prompt nested under settings
    When the online evaluation pipeline executes the monitor for a trace
    Then the settings sent to the judge are identical to those sent before this change

  @regression @unimplemented
  Scenario: Surfaces outside this change keep their behaviour
    Given the evaluation result parser and the evaluation status item
    When their existing suites run
    Then they behave identically to before this change

  @integration @unimplemented
  Scenario: Historical coerced zeros are left untouched
    Given batch evaluation rows written before this change that stored a coerced zero
    When the score nullability migration is applied
    Then those rows are not rewritten
    And a genuine zero remains indistinguishable from a coerced one in that historical data

# --- AC Coverage Map ---
# AC 0a: "The user's prompt reaches the judge on the online path" (both fixtures)
#        -> Scenario: A prompt saved under config.settings reaches the judge
#        -> Scenario: A prompt saved at the top level of config still reaches the judge
# AC 0b: "A settings-less config never reaches the judge as {}"
#        -> Scenario: A settings-less config never reaches the judge as an empty object
# AC 0c: "A config shape the online path cannot read cannot be written" (all four writers)
#        -> Scenario: A config shape the online path cannot read cannot be written
# AC 0c2: "Evaluators that ALREADY have the bad shape are handled", plus its promoted
#         kill-switch criterion (the disable path asserted in BOTH positions)
#        -> Scenario: The new settings resolution is active in the shipped default configuration
#           (⚠ pins the DEFAULT -- without it the whole D6 slice passes with the fix shipped OFF)
#        -> Scenario: The new settings resolution can be switched off for rollback
#        -> Scenario: An evaluator already stored in the unreadable shape still resolves its prompt
# AC 0e: "The behaviour this fix INVERTS is named, and its existing assertions are updated"
#        -> Scenario: The evaluator's own prompt wins over the monitor's parameters
#        -> Scenario: A monitor with no evaluator still falls back to its own parameters
#           (the half of the old contract that SURVIVES; the half that does not is covered by
#           "A prompt saved at the top level of config still reaches the judge" above)
#        -> plus a PR obligation: update executeEvaluation.settings-resolution.unit.test.ts to the
#           new contract rather than deleting it. (An earlier draft also required amending
#           specs/monitors/monitor-execution-backend.feature -- checked, and it does NOT
#           contradict the fix, so that obligation was dropped.)
# AC 0g: "A recovered model key naming an unconfigured provider degrades, not throws"
#        -> Scenario: A recovered model naming an unconfigured provider degrades rather than erroring
#           (setupModelEnv throws EvaluatorConfigError; on main it never runs because the config
#           resolves to {} -- so the rows D6 repairs are exactly the rows that can start erroring)
# AC 0f: "The settings ripple one hop earlier is checked"
#        -> Scenario: Model environment is resolved from the recovered prompt settings
#           (TOP-LEVEL-PROMPT fixture -- the correctly-configured one is forbidden by AC0f as
#           evidence, being unchanged by construction and therefore unable to go red)
# AC 0d: "Prevalence is measured before this issue closes"
#        -> NO SCENARIO. Deliberate: AC0d is a one-off measurement against a production
#           database, not a behaviour of this system. It is a CLOSE gate: it gates issue closure,
#           the P0/P1 re-decision, customer comms and AC0c2's backfill scope. It does NOT block
#           the D6 scenarios above from shipping -- corrected 2026-08-02, an earlier revision
#           said it did, contradicting the demotion applied in the issue's AC section.
# AC 1: "An absent score renders exactly N/A, never 0" (per surviving render site)
#        -> Scenario: An absent score renders as not-scored for a langevals evaluator
#        -> Scenario: An absent score renders as not-scored for a workflow evaluator
# AC 2: "A genuine zero still renders 0" (both families)
#        -> Scenario: A genuine zero from a langevals evaluator still renders as zero
#        -> Scenario: A genuine zero from a workflow evaluator still renders as zero
# AC 3: "No unguarded number formatting remains"
#        -> Scenario: No score value reaches the number formatter unguarded
# AC 4: "The duplicate score column is resolved"
#        -> Scenario: The duplicate workflow score column is resolved
# AC 5: "A non-numeric workflow score is never recorded as a processed zero"
#        -> Scenario Outline: A non-numeric workflow score is never recorded as a processed zero
# AC 6: "A not-scored batch evaluation stores NULL, not 0" (+ genuine zero still 0)
#        -> Scenario Outline: A not-scored batch evaluation stores no score
#        -> Scenario: A genuine zero batch evaluation stores zero
# AC 7: "passed, details AND cost get the same treatment in the same migration"
#        -> Scenario: Passed and details are stored as absent alongside score
#        -> Scenario: A not-scored batch evaluation stores no cost rather than a zero cost
#           (cost axis: evaluations-legacy.ts:509 `cost: cost?.amount ?? 0`, cost Float NOT NULL
#           at schema.prisma:751 -- migrated with the other two, or the scenario is dropped and
#           the exclusion stated. It previously had a parenthetical and no scenario.)
# AC 8: "An all-zero dataset still shows the score metric"
#        -> Scenario: An all-zero dataset still shows the score metric
# AC 9: "The average excludes not-scored rows from numerator and denominator" (+ K === N case)
#        -> Scenario: The average excludes not-scored rows from numerator and denominator
#        -> Scenario: An experiment where nothing was scored shows no numeric average
# AC 10: "A not-scored row renders neutrally, not as a red zero"
#        -> Scenario: A not-scored row renders neutrally rather than as a red zero
# AC 10b: "A processed row whose passed is null does not render as a red False"
#        -> Scenario: A processed row with no pass verdict does not render as a red failure
# AC 11: "formatEvaluationScore gets the characterization test it never had"
#        -> Scenario Outline: The shared score formatter distinguishes absent from zero
# AC 12: "Genuinely-unchanged surfaces stay unchanged"
#        -> Scenario: Surfaces outside this change keep their behaviour
# AC 12b: "Correctly-configured monitors are unaffected — the 99% regression case"
#        -> Scenario: A correctly configured monitor is unaffected
# AC 13: "The nullable-score ripple is stated, not discovered later"
#        -> NO SCENARIO. Deliberate: AC13 is a typecheck and PR-body disclosure obligation,
#           not runtime behaviour. Enforced by `pnpm typecheck:all`, not by a test.
# AC 14: "Rollback — the migration is forward-only"
#        -> Scenario: Historical coerced zeros are left untouched
# AC 15: "Every defect has a disposition"
#        -> NO SCENARIO. Deliberate: bookkeeping, explicitly declared by the issue as NOT
#           behavioral coverage. Verified on the issue, not in CI.
# AC 16: "The reported symptom is explained, not just the defects that were found"
#        -> NO SCENARIO in this file. Deliberate: AC16 demands a reproduction against a real
#           account on the online path, which is an evidence obligation on the PR, not a
#           behaviour this suite can assert. The D6 scenarios encode the MECHANISM; AC16 asks
#           whether that mechanism is what the customer actually hit, and only AC0d's
#           prevalence number can answer that.
#
# AC 18: "The five-site enumeration is completed by grep, not by reasoning"
#        -> Scenario: An experiment summary with no scored rows shows no score rather than zero
#           (BatchEvaluationSummary.tsx:298-306 -- guards only !== undefined; else-branch unguarded)
#        -> Scenario: A not-scored summary card is coloured neither as a failure nor as a pass
#           (BatchEvaluation.tsx:241 -- colour computed OUTSIDE the typeof guard at :245)
#        -> Scenario: A best score that has not loaded yet is not shown as zero
#           (DSPyExperiment.tsx:1469 -- run?.steps optional chain yields undefined while loading)
#        -> plus a PR obligation: quote the repo-wide pattern grep and give every hit a disposition.
# AC 17: "The behavioral contract is committed and actually bound"
#        -> NO SCENARIO. Deliberate: AC17 is a property OF this file, and a scenario asserting
#           its own file is bound would be circular. Enforced by `pnpm check:feature-parity`.
#
# Coverage: every AC in the issue maps to at least one scenario above, EXCEPT the five that
# carry none by design, each justified inline: 0d (a one-off production measurement; a close
# gate), 13 (a typecheck + PR-body disclosure), 15 (bookkeeping, declared non-behavioral by
# the issue), 16 (16a/16b -- a real reproduction against a customer account, a PR obligation),
# and 17 (a property OF this file; a scenario asserting its own file is bound is circular).
#
# ⚠ NO TOTALS ARE STATED HERE ON PURPOSE. Every hardcoded count written into this file or the
# issue went stale within hours -- 24 -> 28 -> 32 -> 34 scenarios, a "19 behavioral ACs" that
# was never right, and a "5 exempt / 27 total" that contradicted its own AC16-is-split clause.
# Derive them instead, and expect the two to agree:
#   grep -cE '^\s+Scenario( Outline)?:' <this file>
#   grep -c '^#        -> Scenario' <this file> AC16 is now split 16a/16b; neither half is assertable by this suite -- 16b's
# gate is a real reproduction against a customer account, which is why it stays a PR obligation.
