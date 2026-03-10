@meta
Feature: Drive PR to mergeable state
  As a developer using Claude Code
  I want a single /drive-pr skill that handles both CI failures and review comments
  So that I don't need to invoke /watch-ci and /pr-review separately

  Scenario: No PR exists for current branch
    Given no PR exists for the current branch
    When /drive-pr is invoked
    Then the skill tells the user and exits

  Scenario: PR with passing CI and no review comments
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks pass
    And there are no unresolved review comments
    Then the skill reports the PR is green and exits

  Scenario: PR with failing CI
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks fail
    Then the skill identifies the failing checks
    And applies fixes and pushes changes
    And re-checks CI and reviews until both are green

  Scenario: PR with unresolved review comments
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks pass
    And there are unresolved review comments
    Then the skill addresses actionable comments
    And replies to non-actionable comments with reasoning
    And pushes changes
    And re-checks CI and reviews until both are green

  Scenario: PR with both CI failures and review comments
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks fail
    And there are unresolved review comments
    Then the skill fixes CI failures
    And addresses review comments
    And pushes all changes
    And re-checks CI and reviews until both are green

  Scenario: Max retry limit reached
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI failures persist after 3 consecutive fix attempts
    Then the skill reports the situation to the user and stops
    # The retry counter resets when CI passes

  Scenario: Single-cycle mode
    Given a PR exists for the current branch
    When /drive-pr is invoked with --once
    Then the skill checks CI status and review comments
    And fixes any issues found
    And pushes changes if any fixes were made
    And exits after one pass
