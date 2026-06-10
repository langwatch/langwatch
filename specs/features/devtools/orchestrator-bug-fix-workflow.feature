Feature: Lightweight bug-fix workflow for orchestrator
  As a developer using the orchestrator
  I want bug issues to follow a shorter workflow than feature issues
  So that simple fixes are not slowed down by unnecessary planning and approval steps

  # Parity status: 0 of 12 scenarios bound to existing tests.
  # Remaining @unimplemented scenarios (#3458):
  #   8 HARNESS_GAP: scenarios describe Claude Code skill behavior
  #     (orchestrate/fix-bug SKILL.md in ~/.claude/skills/) — the TS-only
  #     parity checker cannot bind skill markdown files
  #   4 UPDATE: implementation diverged from spec wording
  #     - "Bug-fix workflow skips plan creation"
  #     - "Bug-fix workflow skips challenge step"
  #     - "Bug-fix workflow runs investigation step"
  #     - "Bug-fix workflow runs verification"
  #     - "Feature issues still use the full workflow"
  # Sections list:
  #   - "Detects bug by GitHub label"
  #   - "Detects bug by title keyword 'fix'"
  #   - "Detects bug by title keyword 'bug'"
  #   - "Detects bug by title keyword 'broken'"
  #   - "Does not classify feature requests as bugs"
  #   - "Bug-fix workflow runs fix step"
  #   - "Bug-fix workflow requires a regression test"
  #   - "Bug-fix workflow runs review"

  # --- Bug detection logic (pure logic) ---

  @unit @unimplemented
  Scenario: Detects bug by GitHub label
    Given an issue with label "bug"
    When the orchestrator classifies the issue
    Then it is classified as a bug

  @unit @unimplemented
  Scenario: Detects bug by title keyword "fix"
    Given an issue with title "Fix broken trace rendering"
    When the orchestrator classifies the issue
    Then it is classified as a bug

  @unit @unimplemented
  Scenario: Detects bug by title keyword "bug"
    Given an issue with title "Bug: sidebar collapses on refresh"
    When the orchestrator classifies the issue
    Then it is classified as a bug

  @unit @unimplemented
  Scenario: Detects bug by title keyword "broken"
    Given an issue with title "Broken pagination on traces page"
    When the orchestrator classifies the issue
    Then it is classified as a bug

  @unit @unimplemented
  Scenario: Does not classify feature requests as bugs
    Given an issue with title "Add dark mode support"
    And the issue has label "enhancement"
    When the orchestrator classifies the issue
    Then it is classified as a feature

  # --- Bug-fix workflow skips heavyweight steps ---

  @integration @unimplemented
  Scenario: Bug-fix workflow skips plan creation
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then no feature file is created
    And the plan step is skipped

  @integration @unimplemented
  Scenario: Bug-fix workflow skips challenge step
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then the challenge step is skipped

  # --- Bug-fix workflow retains essential steps ---

  @integration @unimplemented
  Scenario: Bug-fix workflow runs investigation step
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then the coder agent is invoked to investigate the root cause

  @integration @unimplemented
  Scenario: Bug-fix workflow runs fix step
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then the coder agent is invoked to make the minimal fix

  @integration @unimplemented
  Scenario: Bug-fix workflow requires a regression test
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then the coder agent is instructed to add a regression test
    And the regression test must fail without the fix and pass with it

  @integration @unimplemented
  Scenario: Bug-fix workflow runs verification
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then typecheck is run
    And tests are run

  @integration @unimplemented
  Scenario: Bug-fix workflow runs review
    Given an issue classified as a bug
    When the orchestrator runs the bug-fix workflow
    Then the review step is executed

  # --- Feature workflow is unchanged ---

  @integration @unimplemented
  Scenario: Feature issues still use the full workflow
    Given an issue classified as a feature
    When the orchestrator runs
    Then the plan step is executed
    And the challenge step is executed
    And the user approval step is executed
    And the test review step is executed
    And the implement step is executed
    And the review step is executed
