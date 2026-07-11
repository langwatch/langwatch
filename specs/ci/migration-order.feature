Feature: Migration order check
  As a developer
  I want a PR to fail when its migrations are numbered below ones already on main
  So that a migration I wrote cannot merge in an order that stops it ever running

  Background:
    Given migrations run in the order their keys sort
    And Prisma migrations are keyed by timestamp and ClickHouse migrations by sequence number
    And the migration-order workflow compares the PR against the tip of the base branch
    And only the migrations the PR adds are judged

  Scenario: Migrations numbered above everything on main pass
    Given the newest migration on main is numbered 41
    When the PR adds a migration numbered 42
    Then the check passes
    And no comment is posted

  Scenario: A migration numbered below the newest on main fails
    Given the newest migration on main is numbered 42
    When the PR adds a migration numbered 39
    Then the check fails
    And a comment explains that it is numbered below 42 and would run out of order
    And the comment gives the git mv that renumbers it above 42

  Scenario: Two PRs that picked the same number
    Given a migration numbered 41 merged into main while the PR was open
    When the PR adds a different migration numbered 41
    Then the check fails
    And the comment says the key is already taken on main

  Scenario: Two migrations in one PR share a key
    When the PR adds two migrations numbered 41
    Then the check fails
    And each is offered a different free key

  Scenario: A PR changes a migration that already merged
    Given a migration exists on main
    When the PR modifies, renames or deletes it
    Then the check fails
    And the comment gives the git checkout that restores it

  Scenario: A migration is added with no ordering key
    When the PR adds a migration whose name has no key prefix
    Then the check fails
    And the comment gives the expected naming format

  Scenario: Migrations already on main are never judged
    Given main carries a migration with no key and two that share a key
    When the PR adds no migrations
    Then the check passes

  Scenario: The comment goes away once the migration is renumbered
    Given a PR carries a migration-order comment
    When the author applies the rename and pushes
    Then the check passes
    And the comment is deleted

  Scenario: An unchanged finding is not re-posted on every push
    Given a PR carries a migration-order comment
    When a new commit leaves the findings unchanged
    Then the existing comment is left as it is

  Scenario: A fork PR still fails, without a comment
    Given a PR is opened from a fork
    And its token cannot write comments
    Then the comment step is skipped
    And the check still fails with the reason in the job log
