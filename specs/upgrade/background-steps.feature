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
    Given a pending background step whose run throws on its last attempt
    When the worker sweeps its declared background steps
    Then the step is recorded failed with the error
    And the warning names the step and its declaring module

  @unit
  Scenario: A transiently failing background step is retried after a backoff
    Given a pending background step whose run throws once and then succeeds
    When the worker sweeps before the backoff has passed and again after it
    Then the first failure leaves the step pending with its error and its checkpoint
    And the second sweep skips it, and the third runs it to done

  @unit
  Scenario: A background step that fails every attempt stays failed and alerts
    Given a pending background step whose run always throws
    When the worker sweeps until the attempts are spent
    Then the step is recorded failed after the last attempt
    And an alert names the step, its module and the attempts it made

  @unit
  Scenario: A background step that returns after the worker is told to stop stays resumable
    Given a running background step that returns once its signal is aborted
    When the worker stops mid-step
    Then the step is not recorded done and returns to pending with its saved checkpoint

  @unit
  Scenario: A background step that throws after the worker is told to stop stays resumable
    Given a running background step that throws once its signal is aborted
    When the worker stops mid-step
    Then the step is not recorded failed and returns to pending with its saved checkpoint

  @unit
  Scenario: The lease of a running background step is renewed on a timer
    Given a background step whose one batch outlasts the renewal interval without saving
    When the worker runs it
    Then the lease is renewed while the batch runs

  @unit
  Scenario: A failed lease renewal stops the holder and leaves the step resumable
    Given a running background step whose lease another worker has taken
    When the next renewal is refused
    Then the step's signal is aborted, it is not recorded done, and it returns to pending
    And a checkpoint saved after the loss is refused, so it cannot overwrite the new holder's

  @integration
  Scenario: A worker stopped mid-step leaves it resumable and the next worker finishes it
    Given a worker running a background step that has saved a checkpoint
    When the worker is told to stop, as on SIGTERM
    Then the step is not recorded done and returns to pending with that checkpoint
    And another worker's sweep resumes it from that checkpoint and records it done

  @integration
  Scenario: A batch that outlasts the lease runs once across two workers
    Given a worker running a background step whose one batch lasts longer than the lease
    When a second worker sweeps after the lease would have expired unrenewed
    Then the renewed lease keeps the second worker out
    And the step runs once and is recorded done

  @integration
  Scenario: A renewal refused over the ledger stops the holder
    Given a worker running a background step that has saved a checkpoint
    When another worker takes its lease and the next renewal is refused
    Then the holder's signal is aborted and the step is not recorded done
    And a checkpoint saved after the loss is refused, so the row keeps the earlier one

  @integration
  Scenario: A transient failure over the ledger is retried after its backoff
    Given a pending background step whose run is refused once and then succeeds
    When the worker sweeps before the backoff has passed and again after it
    Then the first failure leaves the step pending with its error and its checkpoint
    And the retry resumes from that checkpoint and records the step done

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
