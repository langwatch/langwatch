Feature: Consumer pause and resume

  While the serving roster entry is lapsed a worker stops serving: its readiness
  answers 503 and its eventing consumers pause. A paused consumer claims no new
  job, intent or wake; work it had already claimed runs to completion. Resuming
  picks up the backlog where it stopped. Pause and resume are synchronous to
  call and idempotent, and no job is lost or run twice across either.

  Background:
    Given a worker consuming a group queue over Redis

  @integration
  Scenario: A paused group queue claims no job
    Given the consumer is paused
    When jobs are staged for several groups
    Then no handler runs while the consumer stays paused

  @integration
  Scenario: A job running when the consumer pauses runs to completion
    Given a handler is running a claimed job
    When the consumer pauses
    Then the running job completes
    And no further job is claimed until the consumer resumes

  @integration
  Scenario: Resuming drains the backlog in per-aggregate order
    Given jobs for two groups were staged while the consumer was paused
    When the consumer resumes
    Then every staged job runs exactly once
    And each group's jobs run in the order they were staged

  @integration
  Scenario: Toggling pause while jobs are claimed neither loses nor repeats a job
    Given jobs are staged across several groups
    When the consumer is paused and resumed repeatedly while it claims them
    And the consumer is finally resumed
    Then every job runs exactly once
    And each group's jobs run in the order they were staged

  @integration
  Scenario: Pause and resume are idempotent
    When the consumer is paused twice and resumed twice
    Then it claims and runs staged jobs as an unpaused consumer would

  @integration
  Scenario: A paused consumer closes promptly
    Given the consumer is paused
    When it is closed
    Then it closes without waiting for a resume

  @unit
  Scenario: A claim already issued when the pause lands runs its jobs
    Given the dispatcher has asked Redis for a batch of jobs
    When the consumer pauses before the batch returns
    Then every job in the returned batch is handed to the handlers
    And the dispatcher asks for no further batch until it resumes

  @unit
  Scenario: A paused process runtime starts no outbox drain
    Given a process runtime with a mounted process manager
    When the runtime pauses
    Then a notified outbox starts no drain
    And a drain already running settles
    And after resuming a notified outbox drains again

  @unit
  Scenario: A runtime paused before it starts stays idle when started
    Given a held process runtime that is paused
    When the runtime starts
    Then no outbox drains until it resumes

  @unit
  Scenario: Eventing pauses and resumes its global queue and process runtime together
    Given an eventing runtime whose global queue can pause
    When its consumers pause and then resume
    Then the global queue pauses and resumes once each
    And a queue started after the pause starts paused
