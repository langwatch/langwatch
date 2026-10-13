Feature: A monitor evaluation is dated by the span it evaluated

  Ruling (Alex, 2026-10-09, seed design Q2 (c)): an on-message monitor evaluation takes the
  evaluated trace's time as its business time, not the time the evaluator ran. The business time
  is the trace's last span end: its span-seeded start plus its wall-clock duration. The event's
  occurredAt carries it, so evaluation_analytics, the per-minute rollup, their partitions and
  their retention TTL all follow the span. The event's createdAt keeps the processing time.
  Manual, batch and API-reported evaluations (guardrails included) are dated as before.

  # trace-evaluation-trigger.subscriber.ts, evaluation-reported-event.service.ts

  @unit
  Scenario: A monitor evaluation is dated by the evaluated trace's last span end
    Given a trace whose spans started at a known time and ran for a known duration
    When an on-message monitor evaluates it and reports a result
    Then the reported event occurs at the start plus the duration
    And the event's creation time is still the time it was processed

  @unit
  Scenario: A failed or skipped monitor evaluation keeps the span's business time
    Given a monitor evaluation of a trace with a span end
    When the evaluator errors or the evaluation is skipped
    Then the reported event still occurs at the span end

  @unit
  Scenario: A summary with no span time leaves the evaluation dated as before
    Given a trace summary with no span-seeded start, or a command queued before this change
    When the monitor evaluation reports
    Then the reported event occurs at the command's own time, the run time it had before
