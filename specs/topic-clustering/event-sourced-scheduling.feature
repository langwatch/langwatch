# See dev/docs/adr/051-event-sourced-topic-clustering.md for the
# architectural rationale (process-manager scheduling, ADR-049 substrate).
Feature: Event-sourced topic clustering scheduling

  Topic clustering runs are scheduled and orchestrated by a per-project
  process manager instead of BullMQ jobs and an external cron. The
  process owns a durable daily wake-up, the run lifecycle, and the
  pagination cursor; the clustering effect itself (mode selection,
  cadence gate, work detection, langevals calls) is unchanged. Every
  run outcome is recorded as an event and reflected in durable state
  the settings page can show.

  Background:
    Given a project with traces eligible for topic clustering
    And the project's clustering process exists with a scheduled daily wake

  Scenario: Daily wake runs clustering and reschedules itself
    When the project's wake comes due
    Then a single clustering run intent is dispatched for today's slot
    And the clustering effect runs with the same gates as before
    And the run outcome is recorded on the project's durable state
    And the next wake is scheduled at the project's next daily slot

  Scenario: Each project keeps a stable daily slot spread across the fleet
    Given two projects with clustering processes
    Then their daily slots differ according to their project identity
    And a project's slot stays the same from one day to the next

  Scenario: Manual trigger runs immediately and surfaces a gate skip
    When the user triggers clustering from the settings page
    Then a clustering run intent is dispatched without waiting for the daily slot
    And the daily schedule is not disturbed
    And if the cadence gate declines the run, the skip reason is recorded and visible

  Scenario: A run in progress is visible while it is still working
    Given a clustering run has started and has not finished
    When the user opens the topic clustering settings page
    Then they see that a run is in progress
    And this holds for a scheduled run as much as a manual one
    And it holds for a run that finishes in a single page

  Scenario: Asking for a run while one is already working says so
    Given a clustering run is already in progress
    When the user asks to run clustering from the settings page
    Then they are told a run is already in progress
    And they are not told a new run has started

  Scenario: A large backlog is processed page by page through durable cursors
    Given a clustering run that fills a whole page of traces
    When the run completes with a continuation cursor
    Then a continuation intent for the next page is dispatched
    And pages continue until a run completes without a cursor

  Scenario: A crash mid-backlog resumes from the last committed page
    Given a clustering run committed its first page and continuation cursor
    When the worker process restarts
    Then the pending continuation intent is recovered from durable storage
    And clustering resumes from the committed cursor, not from the beginning

  Scenario: A failing clustering effect retries then records a visible failure
    Given the clustering effect fails persistently
    When the intent has been attempted 3 times
    Then no further attempts are made for that intent
    And the failure is recorded on the project's durable state
    And the settings page can show the failed outcome

  Scenario: A failure the user can fix shows guidance, not a stack trace
    Given clustering failed because no default model is configured
    When the user opens the topic clustering settings page
    Then they see guidance pointing at the model provider settings
    And the failure is marked as something they can resolve

  Scenario: Internal failures never expose raw error detail to the user
    Given clustering failed inside the clustering service
    When the user opens the topic clustering settings page
    Then they see that the run failed on our side and will retry
    And the raw error text is not returned to the product surface
    And the full error remains recorded for operators

  Scenario: Duplicate event delivery cannot double-run a slot
    Given a committed clustering event is delivered twice
    Then the process consumes it once
    And no duplicate run intent is inserted for the same slot

  Scenario: A stale wake stands down
    Given a wake was scheduled and the process has since advanced
    When the stale wake fires
    Then it causes no state change and no intent

  Scenario: A project's first trace bootstraps its clustering schedule
    Given a project that has never received a trace
    When its first trace arrives
    Then a clustering process is created for the project
    And its first daily wake is scheduled
    And re-sending the bootstrap request changes nothing

  Scenario: Existing projects are backfilled once
    Given eligible projects that predate process-managed scheduling
    When the backfill task runs
    Then each project gets a clustering process with a scheduled wake
    And re-running the backfill task changes nothing

  Scenario: The backfill tolerates starting before the app's first boot
    Given a fresh install whose database schema has not been created yet
    When the backfill task starts before the app has applied migrations
    Then it waits for the schema instead of failing the install
    And once the schema appears the backfill proceeds normally
    And if the schema never appears the task fails visibly rather than hanging forever

  Scenario: The settings page shows the schedule state
    When the user opens the topic clustering settings page
    Then they see the last run's time, mode, and outcome
    And they see when the next run is scheduled

  Scenario: Run status is rebuildable from the event log
    Given the run status read model is lost or corrupted
    When projections are replayed from the event log
    Then the settings page shows the same last-run facts as before

  Scenario: The legacy scheduling stack is gone
    Then no BullMQ topic clustering queue or worker exists
    And no cron endpoint schedules topic clustering
    And trace assignments still flow through the AssignTopic command queue
