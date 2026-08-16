Feature: Automation dispatch on the process-manager substrate
  Automations own an event-sourced pipeline. Trace and evaluation subscribers
  record ID-only trigger matches on that pipeline, where per-trigger ordering,
  durable settlement timers, and leased intent delivery replace the legacy
  ReactorOutbox stack. (ADR-052; timing per ADR-026/027, spam prevention per
  ADR-031, graph alerts per ADR-034, persist class per ADR-035, templates per
  ADR-036/041, and webhook delivery per ADR-040.)

  Background:
    Given a project with active automations

  # --- Match detection and pipeline handoff ---

  Scenario: A matching trace is recorded on the automations pipeline
    Given an active email automation whose filters match a trace
    When the trace's message events commit on the trace pipeline
    Then the post-fold match subscriber records the trigger and trace IDs on the automations pipeline
    And no trace or span content is copied into the automation event
    And the settlement process schedules a wake at the trigger's dispatch boundary

  Scenario: Subscriber redelivery records one match event
    Given a matching trace subscriber job is delivered more than once
    When each delivery sends the same trigger-match command
    Then the deterministic trigger and trace idempotency key records one automation event

  Scenario: Trigger matches remain FIFO end to end
    Given two traces match the same automation in order
    When their match commands and committed automation events are delivered
    Then the settlement process consumes the two matches in that order

  Scenario: Stale and derived trace events never re-run match detection
    Given a trace whose first span is older than the trace age cutoff
    When a derived enrichment event for that trace commits
    Then no automation match command is sent

  Scenario: Evaluation-filtered automations match from the evaluation pipeline
    Given an active automation whose subject reads evaluation results
    When a terminal evaluation event commits for a trace
    Then the evaluation post-fold subscriber records the trigger match on the automations pipeline
    And the trace-pipeline subscriber leaves that automation to the evaluation pipeline

  Scenario: Replays never cause automation reactions
    Given committed trace, evaluation, and automation events
    When any pipeline rebuilds its projections by replaying those events
    Then no match subscriber or process manager runs

  # --- Settlement timing ---

  Scenario: Trace activity in a later window re-arms settlement
    Given a match has completed its current settle window
    When another match for the same trace commits in a later window
    Then a new settlement round records the trace
    And the later round can emit a fresh dispatch intent

  Scenario: Matches in the same cadence window coalesce into one digest
    Given an automation on a digest cadence
    And two traces match inside the same wall-clock cadence window
    When the process wakes at the window boundary
    Then exactly one notify-digest intent is written for both traces

  # One outbox message per matched trace melted under match storms: each
  # message paid the full fixed cost (trigger row, claim check, plan cap,
  # project row) and the dispatcher drains sequentially, so a burst of
  # matches turned into hours of backlog (issue #7016). Pages keep the
  # retry independence at the trace level through the per-trace claims.
  @unit
  Scenario: Settled persist matches dispatch in bounded pages
    Given an automation that adds matched traces to a dataset
    When many traces match and their debounce windows elapse
    Then the settled matches dispatch as pages bounded in size
    And a retry of a page re-runs only the traces not yet claimed

  @unit
  Scenario: A later settlement round is never swallowed by a completed page
    Given a page dispatched for a settle round
    When the same trace matches again in a later settle window
    Then the later round produces a distinct page message

  @unit
  Scenario: Two automations that match the same trace keep separate pages
    Given two automations on one project that add matched traces to a dataset
    And both match the same trace in the same settle window
    When the settled matches dispatch
    Then each automation dispatches its own page

  @unit
  Scenario: An old single-trace persist intent still dispatches after the paging change
    Given a pending persist intent written before the paging change
    When the intent dispatches
    Then the single trace is dispatched exactly as a one-trace page

  @unit
  Scenario: A terminal failure for one trace does not fail its page-mates
    Given a page where one trace's action fails with a non-retryable error
    When the page dispatches
    Then the other traces of the page still dispatch and claim
    And the failed trace is recorded and not retried

  # A claim is written after the action, so a claim write that fails leaves a
  # side effect that no claim can suppress. Persist dispatch accepts that
  # duplicate: the page keeps its retry, because a retryable failure that is
  # never retried loses a dataset row or an annotation-queue item for good,
  # and a settled trace has no guaranteed next match.
  @unit
  Scenario: A failed claim write does not cancel a page-mate's retry
    Given a page where one trace dispatches but its claim write fails
    And another trace fails with a retryable error
    When the page dispatches
    Then the page is retried for the failed trace
    And the dispatched trace can run again instead of being lost

  @unit
  Scenario: A daily-ceiling breach is reported once per page
    Given a page whose traces exceed the automation's daily ceiling
    When the page dispatches
    Then every refused trace stays dropped
    And the breach containment runs at most once for the page

  # The flush record is a log line, so it must cost about as much as a log
  # line. Keying it on a cumulative counter made every entry unique, which
  # defeated the outbox's own dedup and wrote one durable row per overflowed
  # match: a single day of one project's storm produced 119,665 rows whose
  # entire content was "we flushed early again". Keying it on the trigger and
  # the minute of event time coalesces a storm into at most one row per trigger
  # per minute, and the payload still carries the running total so the storm
  # rate is recoverable from any single row.
  @unit
  Scenario: Pending matches are bounded without losing matches
    Given a match storm larger than the pending-match bound
    When the storm is consumed
    Then the oldest matches are dispatched immediately instead of being dropped
    And the early flush is logged with a count
    And at most one overflow entry is written per trigger per minute

  Scenario: Pending settlement survives queue loss
    Given a trigger match has committed into settlement process state
    When the delivery queue is flushed before the dispatch boundary
    Then the durable wake still produces the dispatch intent

  # --- Dispatch ---

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
    Then the leased outbox retries the message with backoff
    And the message dies only after the attempt cap

  Scenario: Cap and suppression drops are terminal
    Given an email dispatch over its hourly cap
    When the intent dispatches
    Then the dispatch completes as a logged drop
    And a retry of the same digest does not burn a second cap slot

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

  Scenario: The scheduled sweep owns absence and resolve evaluations
    Given a no-data graph automation on a project with no recent traffic
    When the graph-alert sweep process wakes
    Then the trigger is evaluated with a heartbeat reason
    And a project whose real-time path is already firing is skipped

  Scenario: Racing workers cannot double-run the sweep
    Given two workers polling the same due sweep wake
    When both attempt to consume it
    Then exactly one revision-fenced commit succeeds

  # --- Legacy remnants ---

  Scenario: In-flight legacy jobs are tombstoned at cutover
    Given a legacy settle, cadence, or graph-evaluation job staged before the deploy
    When the event router receives it
    Then it is acknowledged and dropped with a warning instead of being parsed as an event
