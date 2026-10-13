# Background steps on the worker (ADR-173 section 1; round 14: the framework runs, ops reads and
# requests). A worker that passed the serving gate runs the background steps its modules declare
# with .withMigrations, a few side by side, each under a lease of its own, resuming from the
# checkpoint; a step that runs `after` another waits until that one is done.
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
  Scenario: A step is stamped started only once old writers are gone
    Given a pending background step that needs old writers gone
    And the serving roster says an old writer is live on the first sweep and gone on the second
    When the worker sweeps twice
    Then the step is marked running only on the second sweep, so its start excludes the wait

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

  # Gate review, 2026-10-10: a cut run never runs twice, and a rollback mid-run is caught.
  @unit
  Scenario: A step cut at its deadline keeps its lease until its run settles
    Given a background step whose run ignores its signal past its deadline
    When the deadline passes
    Then the step is pending again and the sweep moves on
    And its lease is still renewed, so no other worker starts a second copy
    And the lease is released once the cut run settles

  @unit
  Scenario: A step resumes from the checkpoint read after taking its lease
    Given a pending background step whose checkpoint moved after the sweep read it
    When the worker takes its lease and runs it
    Then the run resumes from the checkpoint read after the lease

  @unit
  Scenario: A background step whose renewal never answers is stopped
    Given a running background step whose lease renewal hangs
    When the lease's time to live less one renewal interval passes with no renewal
    Then the step's signal is aborted and it is not recorded done

  @unit
  Scenario: A step that needs old writers gone is reopened when an old writer starts during its run
    Given a running background step that needs old writers gone
    And an older image starts serving before the run finishes
    When the run finishes
    Then the step is not recorded done
    And it is pending again with its checkpoint cleared, naming why

  # Queue work from upgrade steps runs ahead of bulk work (Alex, 2026-10-11): each step run sends
  # on a list of its own, which the worker's listed consumer runs ahead of any backlog, and the
  # step is done only once that work has run. Permission changes stay in the normal queue.
  @integration
  Scenario: Queue work an upgrade step sends runs ahead of a backlog
    Given a job queue holding a large backlog of older work
    And an upgrade step sent a command whose handling sends one more job
    When the worker's upgrade-step consumer runs
    Then it runs the command and then the job the command caused
    And it takes no job from the backlog

  # A run's list stays open an hour past its last staged job, not an hour past its opening, so a
  # step that runs for hours keeps its follow-on jobs ahead of the backlog.
  @integration
  Scenario: A listed run's follow-on jobs run ahead of a backlog for as long as the run lasts
    Given a job queue holding a large backlog of older work
    And a listed run whose commands each cause a chain of more jobs
    And the run has lasted as long as its list was first opened for
    When the worker's upgrade-step consumer runs
    Then every command and every job they caused runs
    And it takes no job from the backlog

  @integration
  Scenario: Two listed runs at once each have their jobs run in turn
    Given a listed run with thousands of jobs waiting
    When a second listed run sends a command whose handling sends one more job
    Then the second run's command and the job it caused run while most of the first run's jobs still wait

  @integration
  @unit
  Scenario: A background step is done only once the queue work it sent has run
    Given a worker running a pending background step that sends a command
    When the step's run returns
    Then the step waits until the command and the jobs it caused have run
    And only then is it recorded done, and its list is removed

  @integration
  Scenario: A failed job fails only the step whose list it is on
    Given two background steps running at once, each with its own list
    When a job on the first step's list fails and blocks its group
    Then the first step's run fails naming that group
    And the second step finishes and is recorded done

  # A large step's work drains for longer than any fixed wait: the wait (5 minutes unless the step
  # declares longer) only runs out once no fewer jobs are outstanding for that long. The run's
  # deadline still bounds the whole attempt.
  @integration
  Scenario: A step whose queue work keeps draining waits for it past its wait
    Given a background step whose queue work takes longer than its wait to run
    And fewer of its jobs are outstanding at each look
    When the wait would have run out
    Then the step keeps waiting, and returns once every job has run

  @integration
  @unit
  Scenario: A step whose queue work stops draining fails that attempt and stays resumable
    Given a background step whose queue work has not all run
    When its wait passes with no fewer jobs outstanding
    Then the attempt fails naming the groups still waiting, and its list is removed
    And the step is pending again with its checkpoint kept, to retry after its backoff

  # Background work never starves live traffic (Alex, 2026-10-12): a step's checkpoint saves only
  # once at most 1,000 of its own jobs wait or run, so it sends its next page only after its last
  # has mostly run, and the queue holds about a page and that bound per running step.
  @unit
  Scenario: A step over many rows keeps at most a page and a small bound of its own jobs outstanding
    Given a background step over 10,000 rows that sends one job per row, 500 rows a page
    When the worker runs it
    Then each page's checkpoint saves only once at most 1,000 of its jobs wait or run
    And no more than 1,500 of its jobs are ever outstanding
    And it finishes with every row's job run

  @integration
  Scenario: A listed run waits for room counting only its own jobs
    Given a job queue holding a large backlog of other work
    And a listed run that sends its jobs a page at a time
    When it waits for room for at most a page of its own jobs before each next page
    Then no more than two pages of its jobs are ever outstanding, whatever the backlog holds
    And every job it sent runs

  @integration
  Scenario: A step retried after a failed attempt resumes from its last saved checkpoint
    Given a background step whose attempt saved a checkpoint and then failed
    When the worker retries it after its backoff
    Then the run resumes from the checkpoint the failed attempt saved

  @unit
  Scenario: The upgrade-step consumer leaves the queue's wake-up signal to the main consumer
    Given the worker runs the upgrade-step consumer beside its main consumer
    When the upgrade-step consumer waits for listed work
    Then it claims from each open list in turn, polling, and never takes or clears the queue's shared wake-up signal

  @unit
  Scenario: The upgrade-step consumer claims again as soon as one of its own jobs finishes
    Given the upgrade-step consumer has every slot busy with its own jobs
    When one of those jobs finishes
    Then it claims its next job at once instead of waiting for its next poll

  @unit
  Scenario: Independent background steps run side by side, a few at a time
    Given more pending background steps than the worker runs at once
    When the worker sweeps
    Then it runs that many side by side, each under its own lease, and never more
    And a step that runs after another still waits for it to be done
