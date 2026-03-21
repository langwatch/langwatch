Feature: Simulation Run Cost and Latency Metrics

  Scenario runs need pre-computed cost and latency metrics so the suites page
  can display them without joining traces at query time. Metrics are extracted
  from traces via dual-trigger event sourcing reactors: one on the trace pipeline
  (fires when a trace is processed) and one on the simulation pipeline (fires
  when a scenario message with trace_id arrives or run finishes).

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
  # Trace-side reactor: trace arrives, finds matching simulation run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace-side reactor computes metrics when trace matches a simulation run
    Given a simulation run with TraceIds ["trace-abc"]
    And a trace "trace-abc" with spans:
      | role  | durationMs | cost  |
      | Agent | 1200       | 0.003 |
      | User  | 800        | 0.001 |
      | Judge | 500        | 0.002 |
    When the trace summary fold is updated for "trace-abc"
    Then the reactor queries simulation_runs for trace "trace-abc"
    And dispatches an updateRunMetrics command with:
      | field                | value |
      | totalCost            | 0.006 |
      | agentLatencyMs       | 1200  |
      | agentCost            | 0.003 |
      | judgeCost             | 0.002 |
      | userSimulatorCost    | 0.001 |
      | judgeLatencyMs       | 500   |
      | userSimulatorLatencyMs | 800 |

  @integration
  Scenario: Trace-side reactor ignores traces not linked to simulation runs
    Given no simulation run references trace "trace-xyz"
    When the trace summary fold is updated for "trace-xyz"
    Then no updateRunMetrics command is dispatched

  # ---------------------------------------------------------------------------
  # Simulation-side reactor: message with trace_id arrives
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Simulation-side reactor computes metrics when trace data exists
    Given a simulation run that received a TextMessageEnd with traceId "trace-abc"
    And trace "trace-abc" has been processed with spans containing role attributes
    When the simulation fold processes the TextMessageEnd event
    Then the reactor queries stored_spans for trace "trace-abc"
    And dispatches an updateRunMetrics command with per-role cost and latency

  @integration
  Scenario: Simulation-side reactor succeeds silently when trace not yet available
    Given a simulation run that received a TextMessageEnd with traceId "trace-abc"
    And trace "trace-abc" has NOT been processed yet
    When the simulation fold processes the TextMessageEnd event
    Then the reactor does not dispatch any command
    And does not raise an error

  # ---------------------------------------------------------------------------
  # Fold projection: metrics_updated event
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Fold projection applies metrics_updated event
    Given a simulation run state with null metric fields
    When a metrics_updated event is applied with totalCost 0.006 and agentLatencyMs 1200
    Then the state has totalCost 0.006
    And agentLatencyMs 1200

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
  # Backward compatibility
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Old runs without role attributes still get total cost from trace
    Given a simulation run with TraceIds ["trace-old"]
    And trace "trace-old" has spans WITHOUT "langwatch.scenario.role" attributes
    But the trace summary has totalCost 0.010 and totalDurationMs 3000
    When the reactor computes metrics
    Then totalCost is 0.010
    And agentLatencyMs is null
    And per-role costs are null

  @unit
  Scenario: Deduplication prevents redundant metrics computation
    Given a metrics computation was already dispatched for scenario run "run-1"
    When both reactors fire for the same scenario run
    Then only one updateRunMetrics command is dispatched
