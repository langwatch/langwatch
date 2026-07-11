Feature: Migration ordering comment
  As a developer
  I want to be told when my migrations sort behind ones already merged
  So that a migration I wrote does not silently never run on a deployed database

  Background:
    Given migrations are applied in key order
    And Prisma migrations are keyed by timestamp and ClickHouse migrations by sequence number
    And the migration-order workflow runs on pull_request events
    And it compares the pull request against the current tip of the base branch
    And it identifies its own comment by the hidden marker "<!-- migration-order -->"

  Rule: Only what the pull request adds is judged

    Scenario: A migration added after everything on the base branch is fine
      Given the base branch's newest migration is numbered 41
      When the pull request adds a migration numbered 42
      Then no comment is posted

    Scenario: Migrations already merged are not judged
      Given the base branch carries two migrations that share a key
      And the base branch carries a migration with no key in its name
      When the pull request adds no migrations
      Then no comment is posted

  Rule: A migration that sorts behind the base branch is reported

    Scenario: The base branch moved ahead while the pull request was open
      Given the base branch's newest migration is numbered 42
      When the pull request adds a migration numbered 39
      Then a comment reports that it sorts at or before 42
      And the comment says the migration must be renumbered above 42

    Scenario: Two open pull requests picked the same number
      Given a migration numbered 41 has merged into the base branch
      When the pull request adds a different migration numbered 41
      Then a comment reports that the key is already taken on the base branch

    Scenario: A pull request adds two migrations with the same key
      When the pull request adds two migrations numbered 41
      Then a comment reports that their keys collide

    Scenario: A pull request rewrites a merged migration
      Given a migration exists on the base branch
      When the pull request modifies, renames or deletes it
      Then a comment reports that applied migrations are immutable history

    Scenario: A pull request adds a migration with no ordering key
      When the pull request adds a migration whose name has no key prefix
      Then a comment reports the expected naming format

  Rule: The check advises, it never gates

    Scenario: Findings do not fail the run
      Given the pull request has migration ordering findings
      When the workflow runs
      Then the workflow succeeds
      And the findings appear only as a comment

    Scenario: The check is not a candidate for branch protection
      Given the workflow only ever comments
      Then it is never a required status check

  Rule: The comment does not repeat itself

    Scenario: The same findings are not re-posted on every push
      Given a pull request already carries a migration-order comment
      When a new commit is pushed and the findings are unchanged
      Then the existing comment is left in place
      And no additional comment is created

    Scenario: Changed findings replace the previous comment
      Given a pull request already carries a migration-order comment
      When a new commit changes the findings
      Then the previous comment is removed
      And a comment carrying the new findings is posted

    Scenario: Resolved findings remove the comment
      Given a pull request already carries a migration-order comment
      When the author renumbers the migration and pushes
      Then the comment is deleted
      And no tombstone is left on the thread

  Rule: A reviewer can dismiss findings they disagree with

    Scenario: Reacting with a thumbs down collapses the comment
      Given a pull request carries a migration-order comment
      When someone reacts to it with 👎
      Then the comment collapses to a one-line dismissal on the next run
      And the findings are not repeated while they stay the same

    Scenario: A dismissal does not carry over to new findings
      Given a migration-order comment has been dismissed with 👎
      When a new commit changes the findings
      Then the new findings are posted as a fresh comment

  Rule: Fork pull requests are skipped

    Scenario: A fork pull request gets no comment
      Given a pull request is opened from a fork
      And its token cannot write comments
      Then the workflow skips rather than failing
