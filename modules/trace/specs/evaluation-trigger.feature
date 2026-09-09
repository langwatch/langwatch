Feature: Triggering online evaluations from an ingested trace

  Every trace with a resolved origin is offered to the project's enabled
  on-message monitors, one evaluation command per monitor. Three guards stand
  in front of that dispatch, and each of them exists because of an incident.

  The loop guard is the one that costs money when it fails. An online
  evaluator's workflow emits its own spans; those spans arrive as a trace; that
  trace would trigger the same monitors, whose spans would trigger them again.
  Nothing bounds it but the bill. It happened on 2026-05-11.

  @unit
  Scenario: A span emitted by an evaluator never triggers another evaluation
    Given a span carrying a causality depth of one or more
    When the evaluation trigger runs
    Then no evaluation is dispatched
    And the refusal is counted with the reason the guard fired for

  @unit
  Scenario: A depth of zero is a fresh trace and still dispatches
    Given a span carrying a causality depth of zero
    When the evaluation trigger runs
    Then the evaluation is dispatched, because a re-run of the customer's own app is allowed

  @unit
  Scenario: The loop guard has a system kill switch
    Given the system flag ops_es_causality_loop_guard_disabled is on
    When a span carrying a causality depth arrives
    Then the guard is bypassed and the dispatch proceeds
    And the bypass is logged, so an operator can see the switch is thrown

  @unit
  Scenario: The depth is read from any OTLP encoding
    Given a causality depth encoded as an integer, a string, a double or a bare value
    When the guard reads it
    Then a positive depth blocks and anything else does not

  @unit
  Scenario: A span with no depth attribute is depth zero
    Given a span with no causality depth attribute
    When the guard reads it
    Then the span is treated as depth zero

  @unit
  Scenario: The depth attribute key is a wire format
    Given the evaluator runtime stamps the depth under one attribute key
    When the guard looks for it
    Then only that exact key is read, because a rename on either side removes the guard silently

  @unit
  Scenario: A trace past the processing cap stops being evaluated
    Given a trace whose span count has reached the fold's processing cap
    When the evaluation trigger runs
    Then no evaluation is dispatched
    And the spans are still stored and the trace stays queryable, because we drop the work and never the data

  @unit
  Scenario: The processing cap is the fold's own cap
    Given the summary fold stops deriving past a span count
    When the evaluation trigger reads its cap
    Then it is the same number

  @unit
  Scenario: A synthetic event span never re-triggers evaluation
    Given a synthetic feedback span posted through the track-event route
    When the relevance guard runs
    Then the event is refused before it is enqueued

  @unit
  Scenario: One evaluation command is sent per monitor
    Given a project with several enabled on-message monitors
    When a trace is dispatched
    Then each monitor gets its own command carrying its own identity
    And an evaluator's own name wins over the monitor's when it has one

  @unit
  Scenario: Each evaluation gets its own identifier
    Given several monitors for one trace
    When the commands are built
    Then each carries a distinct evaluation id with the platform's evaluation prefix

  @unit
  Scenario: A trace-level dispatch is deduplicated for six minutes
    Given a trace-level monitor
    When the command is sent
    Then the deduplication window outlasts the deferred origin resolution and survives dispatch

  @unit
  Scenario: The dedup id comes from the evaluation command itself
    Given a command about to be enqueued
    When the queue asks for its deduplication key
    Then the key is the evaluation command's own, not one the trace path spells

  @unit
  Scenario: A thread-level monitor waits for the thread to go idle
    Given a monitor with a thread idle timeout and a trace carrying a conversation id
    When the command is sent
    Then it is delayed by the idle timeout and deduplicated for the same window

  @unit
  Scenario: A thread-level monitor with no thread falls back to the trace window
    Given a monitor with a thread idle timeout and a trace with no conversation id
    When the command is sent
    Then the trace-level window is used

  @unit
  Scenario: The command carries the trace fields preconditions match on
    Given a trace with metadata, labels, topics and models
    When the commands are built
    Then each carries those fields, with reserved metadata keys excluded and malformed labels ignored

  @unit
  Scenario: One monitor's failed send does not stop the others
    Given a queue that rejects one monitor's command
    When the trace is dispatched
    Then the remaining monitors are still dispatched and the failure is logged

  @unit
  Scenario: A project with no monitors sends nothing
    Given a project with no enabled on-message monitors
    When a trace is dispatched
    Then no command is sent

  @unit
  Scenario: The subscriber keeps its registered name
    Given the trace-processing pipeline
    When the subscriber is registered
    Then it is named evaluationTrigger on the trace summary fold, because the name is its queue lane

  @unit
  Scenario: The evaluation trigger composes from published services
    Given a process holding a monitor service, a feature-flag service and an evaluation queue
    When the evaluation trigger is composed
    Then it builds over the narrow monitor and dispatch ports

  @unit
  Scenario: The composed path dispatches one evaluation per monitor
    Given the composed evaluation trigger
    When a trace is ingested
    Then a command is sent for the project's monitor

  @unit
  Scenario: The dedup key is the evaluation command's own
    Given the composed evaluation trigger
    When the queue asks for a command's deduplication key
    Then it is exactly the key the evaluation command mints

  @unit
  Scenario: The composed loop guard refuses an evaluator's own span
    Given the composed evaluation trigger
    When a span carrying a causality depth arrives
    Then nothing is dispatched and the refusal is counted

  @unit
  Scenario: A redelivered trace event evaluates once
    Given the same span event is handled twice
    When both dispatches reach the queue
    Then both carry the same command identity, so one evaluation runs and one charge lands

  @unit
  Scenario: The command identity ignores the freshly minted evaluation id
    Given each delivery mints a new evaluation id
    When the command identity is built
    Then the id is not part of it, because an identity unique per delivery would never deduplicate

  @unit
  Scenario: The identity outlives the first dispatch
    Given the first command has already been dispatched
    When the redelivery arrives inside the window
    Then the still-alive identity squashes it rather than staging a duplicate run
