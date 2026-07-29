Feature: A monitor that should run is never quietly skipped
  As someone who set up a monitor to evaluate my traces
  I want it to run on every trace that matches it
  So that a gap in my results means my traces changed, not that a worker
  restarted at the wrong moment

  # See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
  #
  # Online evaluation execution is already durable — evaluationTrigger
  # dispatches an ExecuteEvaluationCommand onto the GroupQueue, which retries.
  # The gap is one step earlier: the dispatch itself is a reactor, so if it is
  # lost, no command is ever enqueued, nothing retries, and no error is raised
  # anywhere. The trace simply has no evaluation, indistinguishable from a
  # trace the monitor legitimately declined.
  #
  # The same applies to customEvaluationSync, which reports evaluations the
  # same way.
  #
  # A skipped evaluation is worse than a failed one: a failure is visible and
  # can be retried, whereas a skip looks exactly like a monitor working
  # correctly and finding nothing.
  #
  # Companion: evaluation-trigger-skips-derived-and-stale-traces.feature
  # (which traces SHOULD be skipped), online-evaluator-loop-prevention.feature.
  #
  # ADR-075's Class D conversion has landed: the dispatch is a process manager
  # with a leased outbox, so a lost dispatch is retried rather than swallowed.
  # The scenarios that conversion made true are bound. The two still marked
  # @unimplemented are not — a thread-idle wait surviving a restart, and a
  # decline being reported with its reason, are both still unobservable.

  Background:
    Given an enabled monitor that evaluates matching traces

  # ============================================================================
  # Matching traces are evaluated
  # ============================================================================

  @integration
  Scenario: A matching trace is evaluated even if the worker restarts
    Given a trace the monitor should evaluate
    When the process handling it restarts before the evaluation is requested
    Then the evaluation is still requested afterwards

  @integration
  Scenario: A failure to request an evaluation is retried
    Given a trace the monitor should evaluate
    When requesting the evaluation fails
    Then it is requested again
    And the trace is evaluated

  @integration
  Scenario: A trace is not evaluated twice by the same monitor
    Given a trace the monitor has already evaluated
    When the same trace is considered again
    Then no second evaluation is requested

  # ============================================================================
  # Waiting before evaluating
  # ============================================================================
  #
  # Some monitors wait for a thread to go idle before evaluating it. That wait
  # is a durable deadline, not a queue delay — a restart during the wait must
  # not lose it.

  @integration @unimplemented
  Scenario: A monitor that waits for a thread to settle still runs after a restart
    Given a monitor that waits for a conversation to go idle
    And a conversation that has gone quiet
    When every process is restarted before the wait elapses
    Then the evaluation still runs when the wait is over

  @integration
  Scenario: A conversation that resumes pushes the wait out
    Given a monitor waiting for a conversation to go idle
    When another message arrives before the wait elapses
    Then the evaluation waits for the conversation to go idle again

  # ============================================================================
  # Skipping is deliberate and visible
  # ============================================================================

  @integration @unimplemented
  Scenario: A trace the monitor declines is distinguishable from one that was lost
    Given a trace the monitor declines to evaluate
    When the monitor's activity is reviewed
    Then the trace is reported as declined
    And the reason it was declined is available

  @integration
  Scenario: An evaluation that could not be requested is visible
    Given a trace the monitor should evaluate
    When the evaluation cannot be requested despite retries
    Then this is surfaced rather than passing as a trace with no findings

  # customEvaluationSync declines a result whose span happened longer ago than
  # the stale window allows. The window is measured against the span's own
  # time, so an SDK that exports in batches after a long job, a client whose
  # clock runs behind, or a backlogged pipeline all reach it holding a result
  # the customer genuinely computed. Whether that decline should exist at all
  # is ADR-075's open classification question; that it must not be silent is
  # not in question — a dropped result is indistinguishable from an evaluation
  # that never ran.
  @unit
  Scenario: A custom evaluation the platform declines to record is reported
    Given a trace whose SDK reported an evaluation it ran itself
    And the result reaches the platform long after the work happened
    When the platform declines to record it
    Then the decline is reported with the trace, the span, and how late the result was
    And declines are counted, so a sustained loss is noticeable
