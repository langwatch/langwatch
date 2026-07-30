Feature: The evaluation-processing pipeline folds evaluation events into durable state
  As the evaluations platform
  I want the evaluation aggregate's fold to converge correctly regardless of
  delivery order, and the execute-evaluation orchestration to classify
  failures correctly
  So that a finished evaluation is never miscounted as running, and a
  genuine infrastructure failure is never recorded as a completed result

  # Rewritten from event-sourcing.old/pipelines/evaluation-processing onto
  # @langwatch/event-sourcing + @langwatch/clickhouse (ADR-098, ADR-099,
  # ADR-100, ADR-105, ADR-106). See
  # src/server/event-sourcing/evaluation-processing/index.ts for the full
  # account, including the two ClickHouse findings this rewrite reports
  # rather than fixes (the evaluation_analytics moving partition column, and
  # evaluation_analytics_rollup's closed AggregatingMergeTree store).
  #
  # Companion specs: specs/monitors/evaluation-dispatch-durability.feature
  # (the dispatch-loop half of defect #1, owned by trace-processing's
  # evaluationTrigger process manager — outside this pipeline),
  # specs/monitors/evaluation-trigger-skips-derived-and-stale-traces.feature,
  # specs/evaluations/evaluation-payload-offload.feature (the durable-reference
  # offload this pipeline's executeEvaluation service threads through
  # unmodified).

  Background:
    Given the evaluation aggregate declared via defineAggregate

  # ============================================================================
  # A finished evaluation must never be re-counted as running
  # ============================================================================

  @unit
  Scenario: A finished evaluation is never re-counted as running
    Given an evaluation whose "reported" event has already been applied
    When a "started" event for the same evaluation is applied afterwards
    Then the evaluation's status remains its terminal status
    And the evaluation's terminal result is not lost

  @unit
  Scenario: A finished evaluation is never re-counted as running through the fold executor's real delivery path
    Given a "reported" delivery already applied through the fold executor
    When a "started" delivery with a later delivery sequence number arrives
    Then the stored evaluation's status remains its terminal status

  @unit
  Scenario: The evaluation fold converges regardless of delivery order
    Given a "started" event and a "reported" event for the same evaluation
    When the events are folded in every order
    Then every ordering produces the same final state

  @unit
  Scenario: The event type strings are ratcheted against the committed snapshot
    Given the committed type-string snapshot for the evaluation aggregate
    When the aggregate's currently declared event types are compared against it
    Then no previously declared type string is missing

  # ============================================================================
  # A per-evaluation dispatch failure must surface, not be silently absorbed
  # ============================================================================
  #
  # The dispatch loop itself (evaluationTrigger, one command per monitor) is
  # trace-processing's, not this pipeline's — see
  # specs/monitors/evaluation-dispatch-durability.feature for that half. What
  # belongs here is this pipeline's own command handler not defeating that
  # durability from the inside.

  @unit
  Scenario: A monitor that no longer exists is reported as skipped, not retried
    Given an evaluation whose monitor has been deleted
    When the evaluation is executed
    Then a reported event with status skipped is produced

  @unit
  Scenario: Sampling excludes a trace without emitting any event
    Given a monitor whose sample rate excludes the trace
    When the evaluation is executed
    Then no event is produced

  @unit
  Scenario: Unmet preconditions produce no evaluation event
    Given a monitor whose preconditions do not match the trace
    When the evaluation is executed
    Then no event is produced

  @unit
  Scenario: A customer-fixable evaluator failure is reported as skipped
    Given a monitor whose evaluator raises a customer-fixable error
    When the evaluation is executed
    Then a reported event with status skipped is produced
    And the failure is not raised to the caller

  @unit
  Scenario: A genuine evaluator failure surfaces for the caller to retry, never recorded as done
    Given a monitor whose evaluator raises a failure that is not customer-fixable
    When the evaluation is executed
    Then the failure is raised to the caller
    And no reported event is produced

  @unit
  Scenario: The evaluator's own error verdict is reported, not treated as a failure to retry
    Given a monitor whose evaluator returns its own error result without raising
    When the evaluation is executed
    Then a reported event with status error is produced
    And the failure is not raised to the caller
