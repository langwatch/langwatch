# Background steps on the worker (ADR-173 section 1; round 14: the framework runs, ops reads and
# requests). A worker that passed the serving gate runs the background steps its modules declare
# with .withMigrations, one at a time under a lease of their own, resuming from the checkpoint.
# A step that needs old writers gone waits on the serving roster. A paused (lapsed) worker runs none.

Feature: The worker runs declared background steps
  As an operator of a LangWatch installation
  I want background data steps to run on the worker after an upgrade, with no operator
  So that a release finishes in the background without anyone running a command

  @integration
  Scenario: A pending background step runs on the worker and is recorded done
    Given the ledger records the background step "identity:reopen-unproven-accounts" as pending
    When the worker sweeps its declared background steps
    Then the step runs once and is recorded done with the report it returned

  @integration
  Scenario: A step left running by a dead worker resumes from its checkpoint
    Given the ledger records a background step as running with a saved checkpoint and no lease
    When the worker sweeps its declared background steps
    Then the step runs with that checkpoint as its resume point

  @integration
  Scenario: A step another worker holds is skipped
    Given another worker holds the lease of a pending background step
    When the worker sweeps its declared background steps
    Then the step does not run and stays pending

  @unit
  Scenario: A step another worker finished while this one took the lease does not run again
    Given a background step read as pending that another worker finishes before the lease is taken
    When the worker sweeps its declared background steps
    Then the step does not run, is not marked running, and its lease is released

  @integration
  Scenario: A failing background step is recorded failed, naming its module
    Given a pending background step whose run throws
    When the worker sweeps its declared background steps
    Then the step is recorded failed with the error
    And the warning names the step and its declaring module

  @integration
  Scenario: A step that needs old writers gone waits while an old writer is live
    Given a pending background step that needs old writers gone
    And the serving roster says an old writer is still live
    When the worker sweeps its declared background steps
    Then the step does not run and is reported as waiting

  @unit
  Scenario: A worker that stopped serving runs no background step
    Given a worker whose gate stopped serving
    When the worker sweeps its declared background steps
    Then no step runs and the pass reports itself paused

  @unit
  Scenario: Only a gated worker runs background steps, inside its runtime
    Given a worker composed with the serving gate
    When its application starts and later stops
    Then its background steps start after the application and stop before it
