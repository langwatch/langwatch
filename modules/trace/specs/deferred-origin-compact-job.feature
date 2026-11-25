Feature: The deferred origin check queues only identifiers

  A trace whose spans carry no langwatch.origin gets one delayed check, armed by its first
  unresolved span and run five minutes later. If nothing named an origin by then, the check
  sends resolveOrigin with origin "application" and reason "deferred_fallback". Evaluation and
  automation wait on that origin, so the wait, the per-trace deduplication and the fallback stay.

  The queued job used to carry the whole first span_received event and the fold state. It now
  carries the tenant, the trace id and the span's instant, never span content. This release only
  reads both bodies and still writes the full one; the next release flips the code constant
  WRITE_COMPACT_ORIGIN_JOBS once every worker reads the compact body. There is no operator
  setting (Alex, 2026-10-20). Plan: origin-compact-job.

  # Today's behaviour, kept

  @unit
  Scenario: A child span arriving before its root arms the deferred check
    Given a trace's first span is a child span with no origin
    When the trace summary folds it
    Then one deferred check is armed for the trace

  @unit
  Scenario: A late root that names an origin before the deadline leaves nothing to resolve
    Given a deferred check is armed for a trace
    And a root span naming an origin arrives before the check runs
    When the check runs
    Then it re-reads the stored summary and sends no resolveOrigin command

  @unit
  Scenario: A silent trace is resolved as application once the check runs
    Given a deferred check is armed for a trace no span names an origin for
    When the check runs and the stored summary still has no origin
    Then it sends resolveOrigin with origin "application" and reason "deferred_fallback"

  # Reading both bodies

  @unit
  Scenario: A full-event job still queued resolves the trace as before
    Given a job queued by the previous release with the whole first span event
    When the job runs
    Then the trace is resolved from its tenant, trace id and the span's instant

  @unit
  Scenario: A compact job resolves the trace through the same handler
    Given a job carrying only the tenant, the trace id and the span's instant
    When the job runs
    Then the trace is resolved exactly as a full-event job resolves it

  @unit
  Scenario: A compact job whose span went stale while queued resolves nothing
    Given a compact job for a span older than the stale-trace threshold
    When the job runs
    Then no resolveOrigin command is sent

  @unit
  Scenario: A compact job its schema refuses is not run
    Given a compact job body without a trace id
    When the job runs
    Then it fails and no resolveOrigin command is sent

  # Queuing the compact body

  @unit
  Scenario: This release reads compact bodies but still writes the full-event body
    Given the write switch WRITE_COMPACT_ORIGIN_JOBS is false in this release
    Then the deferred check queues its delivery as before
    And with the switch flipped it queues the compact body

  @unit
  Scenario: The compact body carries no span content and stays under one kilobyte
    Given a typical span with attributes, input and output
    When the deferred check stages its job
    Then the body holds only the tenant, the trace id and the span's instant
    And its encoded size is under one kilobyte, against several for the full-event body

  @unit
  Scenario: The deadline and the per-trace deduplication do not depend on the body
    Given the write switch on or off
    Then the check waits five minutes and holds one job per trace either way
