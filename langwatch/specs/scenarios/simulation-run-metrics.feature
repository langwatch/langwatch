Feature: Simulation Run Cost and Latency Metrics

  Scenario runs need pre-computed cost and latency metrics so the suites page
  can display them without joining traces at query time. Per-role cost and
  latency are accumulated in the traceSummary fold projection as spans arrive
  (using the langwatch.scenario.role attribute). Dual-trigger reactors then
  propagate these metrics to the simulation run state.

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
  # Trace-side reactor: propagate metrics to simulation run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace-side reactor propagates fold metrics to matching simulation run
    Given a simulation run with TraceIds ["trace-abc"]
    And the traceSummary fold for "trace-abc" has roleCosts and roleLatencies
    When the traceSummary fold is updated for "trace-abc"
    Then the reactor queries simulation_runs for trace "trace-abc"
    And dispatches an updateRunMetrics command with the fold state's metrics

  @integration
  Scenario: Trace-side reactor ignores traces not linked to simulation runs
    Given no simulation run references trace "trace-xyz"
    When the traceSummary fold is updated for "trace-xyz"
    Then no updateRunMetrics command is dispatched

  # ---------------------------------------------------------------------------
  # Simulation-side reactor: message with trace_id arrives
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Simulation-side reactor reads trace summary when trace data exists
    Given a simulation run that received a TextMessageEnd with traceId "trace-abc"
    And traceSummary for "trace-abc" has been computed with roleCosts and roleLatencies
    When the simulation fold processes the TextMessageEnd event
    Then the reactor reads the traceSummary fold state for "trace-abc"
    And dispatches an updateRunMetrics command with the trace's role metrics

  @integration
  Scenario: Simulation-side reactor succeeds silently when trace not yet available
    Given a simulation run that received a TextMessageEnd with traceId "trace-abc"
    And traceSummary for "trace-abc" does not exist yet
    When the simulation fold processes the TextMessageEnd event
    Then the reactor does not dispatch any command
    And does not raise an error

  # ---------------------------------------------------------------------------
  # Fold projection: metrics_updated event
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Simulation fold stores per-trace metrics and recomputes aggregates
    Given a simulation run state with empty TraceMetrics
    When a metrics_updated event is applied for traceId "trace-1" with totalCost 0.003 and roleCosts {"Agent": 0.003}
    Then TraceMetrics contains an entry for "trace-1"
    And TotalCost is 0.003
    And RoleCosts contains "Agent" with value 0.003
    When a second metrics_updated event is applied for traceId "trace-2" with totalCost 0.002 and roleCosts {"Judge": 0.002}
    Then TotalCost is 0.005
    And RoleCosts contains "Agent" with 0.003 and "Judge" with 0.002

  @unit
  Scenario: Reprocessing a trace replaces its entry (idempotent)
    Given a simulation run with TraceMetrics containing "trace-1" with totalCost 0.003
    When a metrics_updated event is applied for "trace-1" with totalCost 0.004
    Then TraceMetrics["trace-1"].totalCost is 0.004
    And TotalCost reflects the updated value

  # ---------------------------------------------------------------------------
  # Dual-trigger convergence
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Metrics computed regardless of arrival order — trace first
    Given trace "trace-abc" arrives and is processed before the simulation message
    When the simulation run later receives a TextMessageEnd with traceId "trace-abc"
    Then the simulation-side reactor computes and stores the metrics

  @integration
  Scenario: Metrics computed regardless of arrival order — simulation first
    Given a simulation run receives a TextMessageEnd with traceId "trace-abc"
    And trace "trace-abc" has not arrived yet
    When trace "trace-abc" is later processed by the trace pipeline
    Then the trace-side reactor finds the simulation run and computes metrics

  # ---------------------------------------------------------------------------
  # Multiple traces per run (progressive aggregation)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Metrics aggregate across multiple trace IDs as they arrive
    Given a simulation run with TraceIds ["trace-1", "trace-2"]
    And trace "trace-1" has Agent cost 0.003 and Agent latency 1200ms
    And trace "trace-2" has not arrived yet
    When spans for "trace-1" are stored
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
