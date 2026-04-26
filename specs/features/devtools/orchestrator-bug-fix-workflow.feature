Feature: Lightweight bug-fix workflow for orchestrator
  As a developer using the orchestrator
  I want bug issues to follow a shorter workflow than feature issues
  So that simple fixes are not slowed down by unnecessary planning and approval steps

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
