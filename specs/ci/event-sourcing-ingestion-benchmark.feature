Feature: Event-sourcing ingestion benchmark and stability workflow
  As an engineer changing the event-sourcing ingestion path
  I want a rare, opt-in CI run that drives ingestion under load against a
  replicated ClickHouse and asserts correctness
  So that fold double-counting, span loss, and cross-tenant leakage are
  caught before they reach production.

  # Why this exists
  #
  # The fold projections accumulate. A retry that re-applies a batch can
  # double-count trace_summaries.SpanCount; an out-of-order occurredAt can
  # trigger the 2026-07-09 re-fold storm (see hot-trace-fold-amplification);
  # a dispatch fairness bug can starve a tenant (see tenant-soft-cap). None
  # of those show up in a unit test, and none of them show up on a CPU graph.
  # They show up as WRONG NUMBERS IN CLICKHOUSE after concurrent load.
  #
  # This workflow therefore treats resource usage as informational telemetry
  # and correctness as the only gate. See dev/docs/event-sourcing-ingestion-benchmark.md.

  Background:
    Given a kind cluster running a 3-replica ClickHouse and a Redis
    And the platform ingesting through the OTLP receiver

  # ---------------------------------------------------------------------------
  # Triggering — this must be RARE. It is expensive and it is noisy.
  # ---------------------------------------------------------------------------

  @ci @triggering
  Scenario: A pull request that does not touch ingestion does not run the benchmark
    Given a pull request touching only frontend files
    When CI runs
    Then the ingestion benchmark does not run

  @ci @triggering
  Scenario: A pull request touching ingestion without the opt-in label does not run the benchmark
    Given a pull request touching the event-sourcing path
    And the pull request is not labelled "benchmark"
    When CI runs
    Then the ingestion benchmark does not run

  @ci @triggering
  Scenario: A labelled pull request touching ingestion runs the benchmark
    Given a pull request touching the event-sourcing path
    And the pull request is labelled "benchmark"
    When CI runs
    Then the ingestion benchmark runs all three stages

  @ci @triggering
  Scenario: The benchmark can always be run on demand
    Given an engineer wants a reading on a branch
    When they dispatch the workflow manually
    Then the benchmark runs regardless of paths and labels

  @ci @triggering
  Scenario: A manual run can be shaped without editing the workflow
    Given an engineer wants a heavier run on a bigger box
    When they dispatch the workflow and set the runner, workload size, tenant
      count, and settle timeout
    Then the run uses the values they chose
    And every knob the local driver accepts is offered on the form

  @ci @triggering
  Scenario: A mistyped workload size fails immediately
    Given an engineer dispatches the workflow with a workload size that is not
      a positive number
    When the driver starts
    Then it fails straight away naming the offending input
    And it does not spend an hour on a run that could never settle

  @ci @reporting
  Scenario: A benchmark that could not run is not reported as a passing run
    Given the driver cannot reach ClickHouse
    When the run ends
    Then it reports that it could not run, distinctly from finding a violation
    And nobody can read the result as evidence the pipeline is correct

  @ci @reporting
  Scenario: A run that finds a violation is distinguishable from a broken run
    Given the pipeline lost spans under load
    When the run ends
    Then it reports a correctness failure naming the affected traces
    And the report separates it from a benchmark that failed to execute

  # ---------------------------------------------------------------------------
  # Stage 1 — serial stream. The fold hot path and per-aggregate FIFO.
  # ---------------------------------------------------------------------------

  @stage-serial @correctness
  Scenario: A long serial trace stores every span exactly once
    Given one trace whose spans arrive sequentially
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count
    And the trace's summary counts each span exactly once

  # ---------------------------------------------------------------------------
  # Stage 2 — concurrent influx. Dispatch fairness and the per-tenant soft cap.
  # ---------------------------------------------------------------------------

  @stage-concurrent @correctness
  Scenario: Concurrent traces across tenants all land intact
    Given many traces ingesting at once across several tenants
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count
    And each trace's summary counts each of its spans exactly once
    And no tenant is starved of dispatch for the whole stage

  # ---------------------------------------------------------------------------
  # Stage 3 — adversarial. The stage most likely to find a real bug.
  # ---------------------------------------------------------------------------

  @stage-adversarial @correctness
  Scenario: Out-of-order spans are still counted exactly once
    Given spans arriving with occurredAt earlier than the fold checkpoint
    When the stage completes and the pipeline drains
    Then every late span is counted in the trace summary
    And no summary counts a span twice

  @stage-adversarial @correctness
  Scenario: Bursty arrival does not lose or duplicate spans
    Given spans arriving in bursts far above the steady rate
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count

  @stage-adversarial @correctness
  Scenario: Interleaved tenants never see each other's spans
    Given several tenants ingesting interleaved traces in the same burst
    When the stage completes and the pipeline drains
    Then every stored span carries the tenant that sent it
    And no tenant's trace appears under another tenant

  @stage-adversarial @correctness
  Scenario: Payloads near the offload threshold survive the round trip
    Given spans whose attributes sit just below and just above the inline threshold
    When the stage completes and the pipeline drains
    Then every span is stored regardless of which side of the threshold it fell on
    And the over-threshold spans resolve their offloaded content

  # ---------------------------------------------------------------------------
  # Reporting — informational, deliberately not a gate.
  # ---------------------------------------------------------------------------

  @reporting
  Scenario: Each stage reports its resource usage as a job summary
    When the benchmark finishes
    Then a per-stage markdown table shows throughput and peak CPU and memory
    And the raw samples are uploaded as an artifact

  @reporting
  Scenario: Resource usage never fails the run on an absolute threshold
    Given a stage whose CPU or memory reading is far above the previous run
    When the benchmark finishes
    Then the run does not fail on that reading alone
    And the reading is reported for a human to judge

  @reporting
  Scenario: A correctness violation fails the run
    Given a stage where stored spans do not match accepted spans
    When the benchmark finishes
    Then the run fails
    And the summary names the stage and the mismatch

  # ---------------------------------------------------------------------------
  # Bounding — a run that dies on a full volume tells you nothing.
  # ---------------------------------------------------------------------------

  @bounds
  Scenario: The workload is bounded to fit the runner's disk
    Given the runner has a small disk shared with the cluster and the build
    When the benchmark plans its stages
    Then the projected bytes written stay within the configured disk budget
    And the run refuses to start if the budget is already exceeded
