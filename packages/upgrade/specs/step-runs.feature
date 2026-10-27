# How the upgrade runner settles a step's run (migration plan 2026-10-08, F-2, F-3 and the reopen
# cursor; ADR-173). A step is recorded done only when its run finished unaborted; a run cut short
# keeps its checkpoint for the next attempt. Failed background steps get another chance at every
# upgrade run, and a rollback reopen keeps a projection replay's cursor.

Feature: The upgrade runner records a step done only when it finished
  As an operator of a LangWatch installation
  I want a stopped or failed upgrade step to resume rather than to be recorded done or lost
  So that no backfill is left partial while the ledger says it finished

  @integration
  Scenario: A blocking step that returns after the upgrade lost its lease stays resumable
    Given a blocking step that returns once its signal is aborted
    And the upgrade loses its lease while the step runs
    When the run ends
    Then the step is not recorded done, keeps its saved checkpoint, and the run fails as lease lost
    And the next upgrade run resumes the step from that checkpoint

  @integration
  Scenario: An upgrade run resets failed background steps to pending
    Given the ledger records a background step as failed with an error and a checkpoint
    When an upgrade run starts its preflight
    Then the step is pending again with its checkpoint, so the worker retries it

  @integration
  Scenario: A rollback reopen keeps a projection replay step's cursor
    Given a done projection replay step whose report holds the cursor it replayed through
    When a rollback reopens it
    Then its next run replays the lane from that cursor, not from its first-run instant
