Feature: Simulation run cost and latency metrics
  As a LangWatch user looking at a finished simulation run
  I want its cost and latency to appear when the trace reports them, and the
  run to read as costless when the trace honestly has no cost
  So that "no cost" and "we lost your metrics" are never the same thing

  # Two paths produce a run's metrics, and only one of them is a race.
  #
  #   trace side  — simulationMetricsSync.subscriber publishes a trace's
  #                 metrics once the trace has been quiet for 60s. This is the
  #                 "on the go" path: it fires when the metrics actually exist,
  #                 whether that is before or after the run finished. The fold
  #                 merges per-trace entries and is order-independent, so an
  #                 early arrival is harmless.
  #
  #   run side    — traceMetricsSync.subscriber pulls on RunFinished, reading
  #                 the trace summary directly and retrying while it is empty.
  #
  # The run-side ladder used to give up after 3 x 10s = 30s — always before the
  # trace side had even been allowed to fire — and then logged an error saying
  # the run would never have cost or latency. It usually did, moments later,
  # from the other path. So the loudest line in that file was, structurally,
  # almost always wrong: ~122 a day.

  # ==========================================================================
  # The pull ladder must be able to win the race it exists to win
  # ==========================================================================

  @unit
  Scenario: The pull ladder outlasts the trace-side settle debounce
    Given a simulation run whose trace summary has no cost yet
    And fewer attempts have been made than the ladder allows
    When the run's metrics are computed
    Then another attempt is scheduled
    And the ladder's total budget exceeds the trace-side settle debounce

  # ==========================================================================
  # A trace with no cost is a fact, not a failure
  # ==========================================================================
  # A simulation trace can legitimately carry spans with no cost and no role
  # timing at all. An SDK-driven run whose agent executes on the customer's own
  # infrastructure and never reports LLM spans to us is the common case, and no
  # amount of waiting conjures a cost that was never sent. Retrying that to
  # exhaustion and logging an error taught us nothing and buried the one
  # anomaly worth seeing.

  @unit
  Scenario: A trace that reports no cost records the run as costless
    Given a simulation run whose trace summary reports no cost and no role timing
    And the attempts allowed by the ladder are exhausted
    When the run's metrics are computed
    Then a metrics event records the run as costless
    And no further attempt is scheduled
    And the outcome is not logged as an error

  # The run still reads as "no cost" rather than a misleading $0.00, because the
  # fold reports a zero total as null.
  @unit
  Scenario: A costless run does not display a zero price
    Given a simulation run recorded as costless
    When the run's aggregate metrics are folded
    Then the run's total cost is absent rather than zero

  # ==========================================================================
  # A trace that never produced a summary is the anomaly worth alerting on
  # ==========================================================================
  # Kept distinct from the costless case above, and kept at error level, because
  # the two need different responses: one is a customer whose agent reports no
  # LLM spans, the other is a trace that went missing.

  @unit
  Scenario: A trace summary that never arrives emits nothing
    Given a simulation run whose trace never produced a summary at all
    And the attempts allowed by the ladder are exhausted
    When the run's metrics are computed
    Then no metrics event is emitted
    And no further attempt is scheduled
