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
    Then the skill reads the failed check logs
    And diagnoses and fixes the issue
    And pushes the fix
    And waits for CI again using gh pr checks --watch
    And loops back to check CI and reviews

  Scenario: PR with unresolved review comments
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks pass
    And there are unresolved review comments
    Then the skill triages comments into fix-now vs out-of-scope
    And addresses fix-now comments
    And replies to out-of-scope comments with reasoning
    And pushes changes
    And waits for CI again using gh pr checks --watch
    And loops back to check CI and reviews

  Scenario: PR with both CI failures and review comments
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI checks fail
    And there are unresolved review comments
    Then the skill fixes CI failures first
    And then addresses review comments
    And pushes all changes
    And waits for CI again
    And loops back to check both

  Scenario: Max retry limit reached
    Given a PR exists for the current branch
    When /drive-pr is invoked
    And CI failures persist after 3 consecutive fix attempts
    Then the skill reports the situation to the user and stops
    # The retry counter resets when CI passes

  Scenario: Single-cycle mode
    Given a PR exists for the current branch
    When /drive-pr is invoked with --once
    Then the skill takes a snapshot of CI status without blocking
    And checks for unresolved review comments
    And fixes any issues found in either
    And pushes changes if any fixes were made
    And exits without looping or waiting for CI
