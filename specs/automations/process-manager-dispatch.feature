Feature: Automation dispatch on the process-manager substrate
  Automations (trace-match notifications, persist actions, and custom-graph
  threshold alerts) dispatch through the generic process-manager substrate:
  event subscribers detect matches, a per-trigger settlement process owns
  debounce and cadence timing, and the process outbox delivers with
  lease/retry semantics. The legacy ReactorOutbox stack is gone. (ADR-052;
  timing per ADR-026/027, spam prevention per ADR-031, graph alerts per
  ADR-034, persist class per ADR-035, templates per ADR-036/041, webhook
  channel per ADR-040.)

  Background:
    Given a project with active automations

  # --- Match detection (subscribers) ---

  Scenario: A matching trace enters the settlement process
    Given an active email automation whose filters match a trace
    When the trace's message events commit on the trace pipeline
    Then the match subscriber records one pending match for that trigger and trace
    And the settlement process schedules a wake at the trigger's dispatch boundary

  Scenario: Stale and derived events never re-run match detection
    Given a trace whose first span is older than the trace age cutoff
    When a derived enrichment event for that trace commits
    Then no pending match is recorded

  Scenario: Evaluation-filtered automations match from the evaluation pipeline
    Given an active automation whose subject reads evaluation results
    When a terminal evaluation event commits for a trace
    Then the evaluation match subscriber records the pending match
    And the trace-pipeline subscriber leaves that automation to the evaluation pipeline

  # --- Settlement timing (process state) ---

  Scenario: Trace activity extends the settle debounce
    Given a pending match still inside its debounce window
    When another message event for the same trace commits
    Then the match's settle deadline moves later
    And no dispatch intent exists yet

  Scenario: Matches in the same cadence window coalesce into one digest
    Given an automation on a digest cadence
    And two traces match inside the same wall-clock cadence window
    When the process wakes at the window boundary
    Then exactly one notify-digest intent is written for both traces

  Scenario: Persist matches dispatch immediately and individually
    Given an automation that adds matched traces to a dataset
    When two traces match and their debounce windows elapse
    Then one persist intent exists per trace
    And each intent retries independently of the other

  Scenario: Pending matches are bounded
    Given a match storm larger than the pending-match bound
    When the storm is consumed
    Then the oldest overflow matches are dropped
    And the drop is logged with a count

  # --- Dispatch (process outbox handlers) ---

  Scenario: Dispatch re-confirms the match against the settled trace
    Given a pending match whose trace no longer passes the automation's filters at dispatch time
    When the digest intent dispatches
    Then no notification is sent for that trace

  Scenario: A deactivated automation drops its pending dispatches
    Given a digest intent for an automation deleted after the match
    When the intent dispatches
    Then it completes as a drop without sending

  Scenario: A trace is notified at most once per automation
    Given a trace already claimed by a previous dispatch for the same automation
    When a later digest containing that trace dispatches
    Then that trace is suppressed and the remaining traces still send

  Scenario: Retryable provider failures retry with backoff
    Given a digest dispatch whose provider call fails with a retryable status
    When the intent handler throws
    Then the outbox retries the message with backoff
    And the message dies only after the attempt cap

  Scenario: Cap and suppression drops are terminal, not retried
    Given an email dispatch over its hourly cap
    When the intent dispatches
    Then the dispatch completes as a logged drop
    And an outbox retry of the same digest does not burn a second cap slot

  Scenario: Webhook dispatch keeps its delivery contract
    Given an active webhook automation
    When a digest containing one matched trace dispatches
    Then the request goes through the SSRF-fenced sender with a stable event id
    And the delivery is recorded in the webhook delivery log

  # --- Graph alerts ---

  Scenario: Trace activity evaluates graph triggers in near real time
    Given an active graph-threshold automation
    When trace events commit for the project
    Then the activity subscriber evaluates the trigger at most once per debounce window

  Scenario: The sweep process owns absence and resolve evaluations
    Given a no-data graph automation on a project with no recent traffic
    When the sweep process wakes
    Then the trigger is evaluated with a heartbeat reason
    And a project whose real-time path is already firing is skipped

  Scenario: Racing workers cannot double-run the sweep
    Given two workers polling due wakes
    When both pick up the same sweep wake
    Then exactly one commits and the other stands down

  Scenario: The sweep singleton self-heals
    Given the sweep process instance does not exist
    When a worker boots
    Then the bootstrap envelope creates the instance with a wake armed
    And a second boot the same day is a no-op

  # --- Legacy remnants ---

  Scenario: In-flight legacy outbox jobs are tombstoned at cutover
    Given a legacy settle-stage job staged before the deploy
    When the event router receives it
    Then it is acknowledged and dropped with a log, not parsed as an event
