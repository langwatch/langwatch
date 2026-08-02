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

  @integration
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

  @integration
  Scenario: A config shape the online path cannot read cannot be written
    Given a custom LLM-judge evaluator is saved with its prompt at the top level of config
    When the evaluator is written through any of the supported creation and update paths
    Then the stored config is normalised so the online path resolves the user's prompt
    And this holds for the copy and replicate flows, which do not pass through the evaluator service

  @integration
  Scenario: The new settings resolution is active in the shipped default configuration
    Given the application is running in its shipped default configuration
    When the online evaluation pipeline executes a monitor for a trace
    Then the new settings resolution is active

  @integration
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

  @integration
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

  @integration
  Scenario: A recovered model naming an unconfigured provider degrades rather than erroring
    Given an existing evaluator whose stored config names a model whose provider is not configured
    When the online evaluation pipeline executes a monitor backed by that evaluator for a trace
    Then the evaluation reports a named configuration failure
    And it does not throw on every subsequent trace

  # ============================================================================
  # MOVED OUT 2026-08-02 — this file is the D6 slice only
  #   Read surfaces  (D1, D5, D7) -> #6442
  #   Write surfaces (D2, D3)     -> #6443, ships behind #6442 (acc + null === acc)
  # The formatter scenario below is ON LOAN to #6442: its test is already bound and
  # green, and parity fails a file that enforces nothing, so it stays until D6's own
  # tests bind here or #6442's spec step claims it.
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

# --- AC Coverage Map (D6 slice only) ---
# AC 0a: prompt reaches the judge, both config shapes
#        -> Scenario: A prompt saved under config.settings reaches the judge
#        -> Scenario: A prompt saved at the top level of config still reaches the judge
# AC 0b: a settings-less config never reaches the judge as {}
#        -> Scenario: A settings-less config never reaches the judge as an empty object
# AC 0c: an unreadable config shape cannot be written (all four writers; two bypass the service)
#        -> Scenario: A config shape the online path cannot read cannot be written
# AC 0c2: already-bad rows are handled, + the kill switch pinned ON by default
#        -> Scenario: The new settings resolution is active in the shipped default configuration
#        -> Scenario: The new settings resolution can be switched off for rollback
#        -> Scenario: An evaluator already stored in the unreadable shape still resolves its prompt
# AC 0d: prevalence measured. NO SCENARIO -- a one-off production measurement, and a CLOSE gate.
#        Credential-gated: needs an org-level admin API key or the SQL run against prod.
# AC 0e: the behaviour this fix INVERTS is named and its assertions updated
#        -> Scenario: The evaluator's own prompt wins over the monitor's parameters
#        -> Scenario: A monitor with no evaluator still falls back to its own parameters
#        -> plus a PR obligation: update executeEvaluation.settings-resolution.unit.test.ts:122-135
#           to the new contract rather than deleting it.
# AC 0f: the model-env ripple one hop earlier
#        -> Scenario: Model environment is resolved from the recovered settings
# AC 0g: a recovered model naming an unconfigured provider degrades, does not throw every trace
#        -> Scenario: A recovered model naming an unconfigured provider degrades rather than erroring
# AC 12b: correctly-configured monitors unaffected -- the 99% regression case
#        -> covered by the AC0c2 shipped-default scenario plus AC0a's nested-config fixture;
#           needs its own bound test at implementation time (non-custom/, non-native fixture).
# AC 16a/16b: the reported symptom. NO SCENARIO -- a real reproduction against a customer
#        account is a PR obligation, not something this suite can assert.
# AC 11: ON LOAN to #6442 (see the note above)
#        -> Scenario Outline: The shared score formatter distinguishes absent from zero
#
# Derive the totals, never hardcode them -- every count written during this work went stale:
#   grep -cE '^\s+Scenario( Outline)?:' <this file>
#   grep -c '^#        -> Scenario' <this file>
