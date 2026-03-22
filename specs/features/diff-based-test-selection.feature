@skills @testing @diff-selection
Feature: Diff-based test selection for skills scenario tests
  As the LangWatch team
  We want only scenario tests whose dependencies changed to be executed
  So that test time and cost are reduced by 60-80% on typical changes

  Background:
    Given scenario tests live in skills/_tests/
    And each test declares file patterns it depends on (touchfiles)
    And shared infrastructure includes skills/_shared/, skills/_compiler/, and skills/_tests/helpers/

  # ──────────────────────────────────────────────────
  # R1: Touchfile declaration module
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Each test declares its file dependencies as glob patterns
    Given a touchfile map in skills/_tests/helpers/touchfiles.ts
    Then each key is a test name matching a scenario test tag
    And each value is an array of glob patterns representing file dependencies
    And patterns cover the skill directory, shared content, and fixture codebase

  @unit
  Scenario: Global touchfiles trigger all tests when changed
    Given a set of global touchfile patterns
    Then the patterns include "skills/_tests/helpers/**"
    And the patterns include "skills/_tests/vitest.config.ts"
    And the patterns include "skills/_tests/package.json"
    And the patterns include "skills/_compiler/**"

  @unit
  Scenario: Touchfile map covers all scenario tests
    Given the touchfile map and the list of scenario test files
    Then every scenario test tag has a corresponding touchfile entry
    And no touchfile entry references a nonexistent test

  # ──────────────────────────────────────────────────
  # R2: Diff detection and test selection logic
  # ──────────────────────────────────────────────────

  @unit
  Scenario: matchGlob matches files against double-star patterns
    Given the pattern "skills/tracing/**"
    When matching against "skills/tracing/SKILL.md"
    Then the file matches
    When matching against "skills/tracing/nested/deep/file.ts"
    Then the file matches
    When matching against "skills/evaluations/SKILL.md"
    Then the file does not match

  @unit
  Scenario: matchGlob matches files against single-star patterns
    Given the pattern "skills/_tests/*.config.ts"
    When matching against "skills/_tests/vitest.config.ts"
    Then the file matches
    When matching against "skills/_tests/nested/vitest.config.ts"
    Then the file does not match

  @unit
  Scenario: selectTests returns only tests whose dependencies changed
    Given a touchfile map with entries for "tracing-py-openai" and "evaluations-py-openai"
    And "tracing-py-openai" depends on "skills/tracing/**"
    And "evaluations-py-openai" depends on "skills/evaluations/**"
    When the changed files include "skills/tracing/SKILL.md"
    Then "tracing-py-openai" is selected
    And "evaluations-py-openai" is not selected

  @unit
  Scenario: selectTests returns all tests when a global touchfile matches
    Given a touchfile map with entries for "tracing-py-openai" and "evaluations-py-openai"
    And global touchfiles include "skills/_compiler/**"
    When the changed files include "skills/_compiler/compile.ts"
    Then both "tracing-py-openai" and "evaluations-py-openai" are selected

  @unit
  Scenario: selectTests returns no tests when nothing relevant changed
    Given a touchfile map with entries for "tracing-py-openai"
    And "tracing-py-openai" depends on "skills/tracing/**"
    When the changed files include only "langwatch/src/pages/index.tsx"
    Then no tests are selected

  @integration
  Scenario: getChangedFiles detects files changed on the current branch
    Given a git repository with a branch diverged from main
    And the branch has commits modifying "skills/tracing/SKILL.md"
    When getChangedFiles runs with base branch "main"
    Then the result includes "skills/tracing/SKILL.md"

  @integration
  Scenario: getChangedFiles uses EVALS_BASE to override the base branch
    Given the environment variable EVALS_BASE is set to "develop"
    When getChangedFiles runs
    Then it compares against the "develop" branch instead of "main"

  # ──────────────────────────────────────────────────
  # R3: Test tagging for selection
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Touchfile keys correspond to test description tags
    Given a scenario test with description "tracing-py-openai"
    And the touchfile map has an entry keyed "tracing-py-openai"
    Then the selection logic can match the test to its dependencies

  @unit
  Scenario: Selected tests produce a vitest grep pattern
    Given selected tests are "tracing-py-openai" and "evaluations-ts-vercel"
    When a grep pattern is generated
    Then the pattern matches both test descriptions
    And the pattern can be passed to vitest via the --grep flag

  @unit
  Scenario: Empty selection produces no grep pattern
    Given no tests are selected
    When a grep pattern is generated
    Then the result indicates no tests should run

  # ──────────────────────────────────────────────────
  # R4: Selection preview command
  # ──────────────────────────────────────────────────

  @integration
  Scenario: Preview command displays the base branch used for comparison
    When running "pnpm test:select"
    Then the output includes the base branch name

  @integration
  Scenario: Preview command lists changed files
    Given files have changed on the current branch
    When running "pnpm test:select"
    Then the output lists each changed file

  @integration
  Scenario: Preview command shows selected and skipped test counts
    Given some tests are selected by the diff
    When running "pnpm test:select"
    Then the output shows the number of selected tests out of the total
    And the output shows the number of skipped tests
    And the output does not execute any tests

  @integration
  Scenario: Preview command shows override instructions
    When running "pnpm test:select"
    Then the output includes "EVALS_ALL=1" as an override option

  # ──────────────────────────────────────────────────
  # R5: Override and force-all mode
  # ──────────────────────────────────────────────────

  @unit
  Scenario: EVALS_ALL=1 selects all tests regardless of diff
    Given EVALS_ALL is set to "1"
    When test selection runs
    Then all tests in the touchfile map are selected
    And diff detection is bypassed

  @unit
  Scenario: EVALS_ALL=1 prints a notice
    Given EVALS_ALL is set to "1"
    When test selection runs
    Then the output includes "running all tests regardless of diff"

  @unit
  Scenario: Without EVALS_ALL diff-based selection is the default
    Given EVALS_ALL is not set
    When test selection runs
    Then only tests matching the diff are selected

  # ──────────────────────────────────────────────────
  # R6: Integration with multi-assistant matrix
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Diff-based selection is independent of the assistant under test
    Given AGENT_UNDER_TEST is set to "codex"
    And the diff selects "tracing-py-openai"
    When test selection runs
    Then "tracing-py-openai" is still selected
    And the assistant choice does not affect which tests are selected

  @integration
  Scenario: Diff-based selection combines with per-assistant test runs
    Given AGENT_UNDER_TEST is set to "claude-code"
    And only "evaluations-py-openai" is selected by the diff
    When "pnpm test:e2e" runs
    Then only "evaluations-py-openai" executes against the Claude Code runner
    And skipped tests are not invoked for any assistant

  @unit
  Scenario: EVALS_ALL=1 runs all tests for the active assistant
    Given EVALS_ALL is set to "1"
    And AGENT_UNDER_TEST is set to "codex"
    When test selection runs
    Then all tests are selected
    And they execute against the Codex runner
