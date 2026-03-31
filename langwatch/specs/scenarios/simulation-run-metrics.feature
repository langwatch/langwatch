Feature: Simulation Run Cost and Latency Metrics

  Scenario runs need pre-computed cost and latency metrics so the suites page
  can display them without joining traces at query time. Per-role cost and
  latency are accumulated in the traceSummary fold projection as spans arrive
  (using the langwatch.scenario.role attribute).

  The trace-side reactor acts as an ECST (Event-Carried State Transfer)
  publisher: after a trace stabilises (60s of no new spans), it publishes
  the metrics to the simulation pipeline. The simulation-side reactor on
  RunFinished handles the reverse ordering via pull-based computation with
  deferred retry for late traces.

  Metrics are stored as Maps: RoleCosts Map(String, Float64) and
  RoleLatencies Map(String, Float64) — extensible for new roles/metrics
  without schema changes.

  Background:
    Given a project with simulation runs stored in ClickHouse
    And traces are processed via the trace-processing pipeline
    And simulation runs are processed via the simulation-processing pipeline

  # ---------------------------------------------------------------------------
  # Role Attribution (SDK side)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Scenario executor sets role attribute on agent spans
    Given a scenario with an AgentAdapter, UserSimulatorAgent, and JudgeAgent
    When the scenario executor calls each agent
    Then each agent's span has a "langwatch.scenario.role" attribute
    And the AgentAdapter span has role "Agent"
    And the UserSimulatorAgent span has role "User"
    And the JudgeAgent span has role "Judge"

  # ---------------------------------------------------------------------------
  # Trace summary fold: per-role accumulation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Trace summary fold accumulates per-role cost and latency from spans
    Given a trace with spans:
      | role  | durationMs | cost  |
      | Agent | 1200       | 0.003 |
      | User  | 800        | 0.001 |
      | Judge | 500        | 0.002 |
    When all spans are folded into the trace summary
    Then the fold state has totalCost 0.006
    And roleCosts is {"Agent": 0.003, "User": 0.001, "Judge": 0.002}
    And roleLatencies is {"Agent": 1200, "User": 800, "Judge": 500}

  @unit
  Scenario: Trace summary fold ignores spans without role attribute
    Given a trace with spans that have no "langwatch.scenario.role" attribute
    When all spans are folded into the trace summary
    Then roleCosts is empty
    And roleLatencies is empty
    And totalCost is computed normally from all spans

  # ---------------------------------------------------------------------------
  # Trace-side reactor: ECST publisher
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace-side reactor publishes metrics via ECST after trace stabilises
    Given a trace with scenario.run_id "run-1" and role cost data
    When the trace stabilises (60s after last span)
    Then the reactor dispatches computeRunMetrics with metrics in the payload
    And the simulation pipeline receives and applies the metrics

  @integration
  Scenario: Trace-side reactor ignores non-scenario traces
    Given a trace without scenario.run_id in its attributes
    When the traceSummary fold is updated
    Then no computeRunMetrics command is dispatched

  # ---------------------------------------------------------------------------
  # Simulation-side reactor: pull-based on RunFinished
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Simulation-side reactor dispatches pull-based computation on RunFinished
    Given a simulation run with TraceIds ["trace-1", "trace-2"]
    And trace "trace-1" has metrics already applied via ECST
    And trace "trace-2" has no metrics yet
    When the simulation run finishes
    Then the reactor dispatches computeRunMetrics (pull mode) for "trace-2" only
    And skips "trace-1" because TraceMetrics already contains it

  @integration
  Scenario: Pull-mode command reads trace summary and emits event
    Given a computeRunMetrics command for "trace-1" with no metrics in payload
    And the trace summary store has data for "trace-1"
    When the command handler processes the command
    Then it reads the trace summary from the store
    And emits a MetricsComputed event with the trace's cost and latency data

  @integration
  Scenario: Pull-mode command schedules deferred retry for missing traces
    Given a computeRunMetrics command for "trace-1" with no metrics in payload
    And the trace summary store has no data for "trace-1"
    When the command handler processes the command
    Then it schedules a deferred retry with incremented retryCount
    And no MetricsComputed event is emitted

  # ---------------------------------------------------------------------------
  # Fold projection: metrics_computed event
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Simulation fold stores per-trace metrics and recomputes aggregates
    Given a simulation run state with empty TraceMetrics
    When a metrics_computed event is applied for traceId "trace-1" with totalCost 0.003 and roleCosts {"Agent": 0.003}
    Then TraceMetrics contains an entry for "trace-1"
    And TotalCost is 0.003
    And RoleCosts contains "Agent" with value 0.003
    When a second metrics_computed event is applied for traceId "trace-2" with totalCost 0.002 and roleCosts {"Judge": 0.002}
    Then TotalCost is 0.005
    And RoleCosts contains "Agent" with 0.003 and "Judge" with 0.002

  @unit
  Scenario: Reprocessing a trace replaces its entry (idempotent)
    Given a simulation run with TraceMetrics containing "trace-1" with totalCost 0.003
    When a metrics_computed event is applied for "trace-1" with totalCost 0.004
    Then TraceMetrics["trace-1"].totalCost is 0.004
    And TotalCost reflects the updated value

  # ---------------------------------------------------------------------------
  # Convergence: both arrival orders handled
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Metrics computed regardless of arrival order — trace first
    Given trace "trace-abc" arrives and is processed before the simulation finishes
    When the trace stabilises (60s after last span)
    Then the trace-side ECST reactor publishes metrics to the simulation run

  @integration
  Scenario: Metrics computed regardless of arrival order — simulation first
    Given a simulation run finishes with TraceIds ["trace-abc"]
    And trace "trace-abc" has not arrived yet
    When the RunFinished reactor dispatches computeRunMetrics (pull mode)
    Then the command schedules a deferred retry
    And when "trace-abc" eventually arrives, the retry succeeds

  # ---------------------------------------------------------------------------
  # Multiple traces per run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Metrics aggregate across multiple trace IDs as they arrive
    Given a simulation run with TraceIds ["trace-1", "trace-2"]
    And trace "trace-1" has Agent cost 0.003 and Agent latency 1200ms
    And trace "trace-2" has not arrived yet
    When trace "trace-1" stabilises
    Then metrics are computed from trace-1 only (partial)
    When trace "trace-2" later arrives with Agent cost 0.002 and Agent latency 800ms
    Then metrics are recomputed from both traces (complete)
    And totalCost reflects the sum across all traces

  # ---------------------------------------------------------------------------
  # Backward compatibility
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Old runs without role attributes still get total cost from trace
    Given a simulation run with TraceIds ["trace-old"]
    And trace "trace-old" has spans WITHOUT "langwatch.scenario.role" attributes
    But the trace summary has totalCost 0.010
    When the reactor computes metrics
    Then totalCost is 0.010
    And roleCosts is empty
    And roleLatencies is empty

  # ---------------------------------------------------------------------------
  # No tracing scenario
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Run with no trace IDs leaves metrics empty
    Given a simulation run that finished with empty TraceIds
    When the RunFinished event is processed
    Then no metrics computation is triggered
    And TotalCost remains null
