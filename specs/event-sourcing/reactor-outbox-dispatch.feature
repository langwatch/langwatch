Feature: Reactor Outbox dispatch for stake-sensitive reactors

  Some reactors do work that cannot be silently swallowed: sending an email,
  posting a Slack message, writing to a customer dataset. These
  "stake-sensitive" reactors register through `.withOutbox` instead of
  `.withReactor` so every dispatch attempt is durable, retried with backoff,
  and queryable for operator surfaces.

  Best-effort reactors (UI websockets, fold projections, idempotent syncs)
  keep using `.withReactor` — they do not pay the outbox cost.

  Two reactors evaluate user-defined alert triggers and dispatch their
  configured action: the trace-pipeline reactor handles triggers whose filters
  are trace-only, and the evaluation-pipeline reactor handles triggers that
  also filter on evaluation results. Both can fire for the same trigger and
  trace, so they share a match-claim (`TriggerSent`) that guarantees a trigger
  dispatches at most once per trace, then enqueue onto the outbox for the
  durable dispatch lifecycle.

  See dev/docs/adr/025-transactional-outbox-for-stake-sensitive-dispatch.md.

  Background:
    Given a pipeline registers a reactor "alertDispatch" via .withOutbox
    And the ReactorOutbox table is empty

  Rule: A matching trigger is claimed once and enqueued onto the outbox

    Scenario: A matching trace-only trigger is claimed then enqueued
      Given an active trigger whose trace-only filters match an incoming trace
      When the trace-pipeline reactor evaluates it
      Then it claims the match for this trigger and trace
      And a ReactorOutbox row is created with status "queued"
      And the row carries reactorName, projectId, dedupKey, and payload
      And the dedupKey begins with "${projectId}/" so it is self-describing for operator scans
      And no side effect (email, Slack, dataset write) has fired yet

    Scenario: A matching evaluation trigger fires on the evaluation pipeline
      Given an active trigger with evaluation filters that match a completed evaluation
      When the evaluation-pipeline reactor evaluates it
      Then it claims the match for this trigger and trace
      And the dispatch is enqueued onto the outbox

    Scenario: A trigger dispatches at most once across racing pipelines
      Given the trace and evaluation pipelines both match the same trigger and trace
      When both reactors attempt to claim the match
      Then exactly one claim succeeds
      And a single outbox row is enqueued

    Scenario: A trigger already sent for this trace is skipped
      Given a trigger whose match was already claimed for this trace
      When a reactor evaluates it again
      Then the claim fails
      And no outbox row is enqueued
      And the trigger is not recorded as having run again

    Scenario: Duplicate matches collapse on the dedupKey
      Given a ReactorOutbox row exists for (reactorName, dedupKey)
      When the same match is observed again (e.g. replay, retry, fan-in)
      Then the second enqueue is a no-op
      And only one row exists for (reactorName, dedupKey)

  Rule: The main event-sourcing queue owns outbox dispatch scheduling and execution

    Scenario: Enqueue sends a stage-discriminated payload onto the main event-sourcing queue
      When a new row is enqueued
      Then a payload {stage, projectId, triggerId, …} is sent to the main event-sourcing queue
      And the queue routes settle/cadence payloads to the outbox dispatcher via a payload-discriminator branch
      And the groupKey begins with "${projectId}/" so per-tenant fairness routing works
      And the payload carries the full dispatch context, not just a wakeup signal

    Scenario: A groupKey missing the project prefix is rejected at enqueue
      When the producer calls enqueue with a groupKey that does NOT start with "${projectId}/"
      Then enqueue throws before any row is written
      And the contract violation is surfaced to the producer rather than landing in the wrong tenant bucket

    Scenario: The queue lease + dispatch runs the row exactly once
      Given a queued ReactorOutbox row whose dispatch time has elapsed
      When the queue dispatches the (reactorName, groupKey) job
      Then exactly one worker observes status "dispatching"
      And competing workers see no claimable row

    Scenario: Successful dispatch marks the row "dispatched"
      Given a row being dispatched
      When the dispatch endpoint returns success
      Then the row moves to status "dispatched"
      And the row is retained for operator inspection

  Rule: Dispatch failures route through the DispatchError contract

    Scenario: Retryable failure schedules a backoff retry
      Given a row being dispatched
      When the dispatch endpoint raises a retryable DispatchError
      Then the row moves to status "failed_retryable"
      And attempts is incremented
      And the next retry is scheduled per exponential backoff
      And lastError records the error message

    Scenario: A retryable provider failure on first cadence attempt actually resends on retry
      Given a cadence batch has been built for one matching (trigger, trace) pair
      And no prior TriggerSent claim exists for that pair
      When the first dispatch attempt's provider call raises a retryable DispatchError
      Then no TriggerSent claim is committed for the pair on the first attempt
      And the failure propagates so the outbox schedules a retry
      And on the second attempt the provider call fires again rather than silently no-opping
      And only after a successful provider call is TriggerSent claimed for the pair

    Scenario: Non-retryable failure marks the row "dead"
      Given a row being dispatched
      When the dispatch endpoint raises a non-retryable DispatchError
      Then the row moves to status "dead"
      And no further attempts are scheduled
      And lastError records the error message

    Scenario: Worker crash mid-dispatch releases the lease and retries
      Given a row leased to a worker that never completed
      When the lease expires
      Then a future queue dispatch may re-run the row
      And attempts is incremented on the re-run
      And the row is not silently stuck in "dispatching"

    Scenario: Attempts cap promotes a retryable failure to "dead"
      Given a row that has reached the maximum retry count
      When another retryable failure occurs
      Then the row moves to status "dead" rather than "failed_retryable"

    Scenario: One trigger's failure does not block the others
      Given several matching triggers where one dispatch raises a DispatchError
      When the queue dispatches the batch
      Then the remaining triggers are still evaluated and dispatched
      And only the failing row's status reflects the error

  Rule: Replay never re-dispatches

    Scenario: Replaying past events does not re-dispatch already-claimed matches
      Given a pipeline replays historical events
      And those events previously produced ReactorOutbox rows
      When the reactor re-evaluates the same matches
      Then no new rows are created (dedupKey collision)
      And no additional side effects fire

    Scenario: Replay short-circuits .withOutbox match after row retention has elapsed
      Given an event is being replayed (ReactorContext.isReplay is true)
      And the original ReactorOutbox row has aged out of retention
      When the .withOutbox framework wrapper inspects the context
      Then the reactor's match phase is skipped before any row is inserted
      And no enqueue is performed
      And no customer-visible side effect fires

  Rule: Operators can see and act on dispatch state

    Scenario: Stuck dispatches are queryable per (project, reactor)
      Given rows in statuses "queued", "failed_retryable", and "dead"
      When an operator queries the outbox for a project
      Then rows are filterable by reactorName and status
      And each row exposes attempts, lastError, and timestamps
