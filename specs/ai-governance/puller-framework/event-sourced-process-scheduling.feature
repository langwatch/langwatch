Feature: Durable event-sourced scheduling for pull-mode ingestion
  Pull-mode ingestion uses process state and a transactional outbox so Redis
  is transport, not the authority for schedules, cursors, or pending pulls.

  Scenario: Configuring a pull source creates a durable wake
    Given an active pull-mode source with a valid five-field cron schedule
    When its configuration event is committed
    Then its ingestion-pull process stores the schedule and cursor in Postgres
    And nextWakeAt is the next UTC cron slot

  Scenario: A wake atomically creates one pull intent
    When the source process becomes due
    Then it records the in-flight run and next wake with one outbox intent
    And the intent identity includes both source id and scheduled slot

  Scenario: An outage causes one catch-up pull
    Given a source wake became due while workers were offline
    When a worker handles the overdue wake
    Then one pull runs from the durable cursor
    And the next wake is strictly in the future
    And every missed cron slot is not replayed

  Scenario: Pulls for one source never overlap
    Given a source already has a healthy in-flight run
    When another cron wake becomes due
    Then no second pull intent is created

  Scenario: Partial OCSF failure preserves the cursor
    Given a provider page returns multiple audit events
    When any OCSF event insert fails
    Then the outbox attempt fails
    And no completion event advances the cursor
    And a retry starts again from the same cursor

  Scenario: Successful retries are idempotent
    Given an attempt wrote OCSF rows and crashed before recording completion
    When the same outbox intent is delivered again
    Then source-qualified event identities collapse duplicate OCSF rows
    And only one completion event is accepted

  Scenario: Exhausted retries become a durable failure
    When a pull fails on its final outbox attempt
    Then a run-failed event is committed
    And the status projection increments consecutive errors
    And the next cron wake remains scheduled

  Scenario: Disabling a source clears its wake
    When an active pull source is disabled or archived
    Then a schedule-disabled event clears nextWakeAt
    And a late run outcome cannot re-enable the process

  Scenario: Redis loss does not erase work
    Given a source has a committed wake or pending pull intent
    When Redis is flushed and workers restart
    Then Postgres recovers the wake and outbox intent
    And the canonical run events remain in the event log
