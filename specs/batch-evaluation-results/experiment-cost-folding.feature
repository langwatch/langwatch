@integration
Feature: Experiment trace cost folding
  As a user running SDK experiments
  I want trace costs to be automatically folded into experiment run results
  So that I can see LLM costs per row and per run without manual tracking

  Background:
    Given an SDK experiment is running via evaluation.loop()
    And each iteration creates an OpenTelemetry trace with evaluation.run_id attribute
    And the trace contains LLM spans with model and token usage

  # ============================================================================
  # Trace Attribute Hoisting
  # ============================================================================

  Scenario: evaluation.run_id is hoisted to trace-level attributes
    Given a span has the attribute evaluation.run_id set to "run-abc"
    When the trace processing pipeline processes the span
    Then the trace summary attributes include evaluation.run_id = "run-abc"

  # ============================================================================
  # ECST: Trace-side Metrics Publishing
  # ============================================================================

  Scenario: Trace metrics are published to experiment pipeline after stabilisation
    Given a trace has evaluation.run_id = "run-abc" in its attributes
    And the trace has a total cost of $0.003
    When the trace stabilises after 60 seconds of no new spans
    Then the experimentMetricsSync reactor dispatches computeExperimentRunMetrics
    And the command payload includes traceId and totalCost = 0.003

  Scenario: Reactor does not fire for traces without evaluation.run_id
    Given a trace has no evaluation.run_id attribute
    When the trace stabilises
    Then the experimentMetricsSync reactor does not dispatch any command

  Scenario: Reactor does not fire when trace has no cost data
    Given a trace has evaluation.run_id = "run-abc"
    And the trace has no cost data
    When the trace stabilises
    Then the experimentMetricsSync reactor does not dispatch any command

  # ============================================================================
  # Fold Projection: Aggregate Cost Accumulation
  # ============================================================================

  Scenario: Trace cost is accumulated into experiment run TotalCost
    Given an experiment run fold state with TotalCost = null
    When a TraceMetricsComputedEvent arrives with totalCost = 0.003
    Then the fold state TotalCost becomes 0.003

  Scenario: Multiple trace costs accumulate
    Given an experiment run fold state with TotalCost = 0.003
    When a TraceMetricsComputedEvent arrives with totalCost = 0.002
    Then the fold state TotalCost becomes 0.005

  Scenario: Per-trace cost breakdown is maintained
    Given an experiment run has processed traces t1 (cost=0.003) and t2 (cost=0.002)
    Then the fold state TraceMetrics contains entries for both t1 and t2
    And TraceMetrics[t1].totalCost = 0.003
    And TraceMetrics[t2].totalCost = 0.002

  # ============================================================================
  # Read-time Enrichment: Per-item Costs
  # ============================================================================

  Scenario: Single-target experiment items get cost from their trace
    Given an experiment run item has traceId = "trace-1"
    And trace_summaries has TotalCost = 0.003 for trace-1
    When fetching run results via getRun()
    Then the dataset entry for trace-1 has cost = 0.003

  Scenario: Multi-target items split trace cost evenly
    Given an experiment run has two target items sharing traceId = "trace-1"
    And trace_summaries has TotalCost = 0.006 for trace-1
    When fetching run results via getRun()
    Then each dataset entry for trace-1 has cost = 0.003

  # ============================================================================
  # End-to-end
  # ============================================================================

  Scenario: Cost appears in SDK experiment results DataFrame
    Given I run an SDK experiment with evaluation.loop()
    And the model calls incur real LLM costs
    When the experiment completes and I access evaluation.results
    Then the DataFrame includes a cost column with non-null values
    And the cost values match the LLM usage from the traces

  Scenario: Cost appears in experiment results UI
    Given an experiment run has completed with trace costs folded
    When I view the experiment results page
    Then the cost column shows the folded costs from traces
    And the run summary shows the total accumulated cost
