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

  @ci @triggering @e2e @unimplemented
  Scenario: A pull request that does not touch ingestion does not run the benchmark
    Given a pull request touching only frontend files
    When CI runs
    Then the ingestion benchmark does not run

  @ci @triggering @e2e @unimplemented
  Scenario: A pull request touching ingestion without the opt-in label does not run the benchmark
    Given a pull request touching the event-sourcing path
    And the pull request is not labelled "benchmark"
    When CI runs
    Then the ingestion benchmark does not run

  @ci @triggering @e2e @unimplemented
  Scenario: A labelled pull request touching ingestion runs the benchmark
    Given a pull request touching the event-sourcing path
    And the pull request is labelled "benchmark"
    When CI runs
    Then the ingestion benchmark runs all three stages

  @ci @triggering @e2e @unimplemented
  Scenario: The benchmark can always be run on demand
    Given an engineer wants a reading on a branch
    When they dispatch the workflow manually
    Then the benchmark runs regardless of paths and labels

  @ci @triggering @e2e @unimplemented
  Scenario: A manual run can be shaped without editing the workflow
    Given an engineer wants a heavier run on a bigger box
    When they dispatch the workflow and set the runner, workload size, tenant
      count, and settle timeout
    Then the run uses the values they chose
    And every knob the local driver accepts is offered on the form

  @ci @triggering @unit
  Scenario: A mistyped workload size fails immediately
    Given an engineer dispatches the workflow with a workload size that is not
      a positive number
    When the driver starts
    Then it fails straight away naming the offending input
    And it does not spend an hour on a run that could never settle

  @ci @preflight @e2e @unimplemented
  Scenario: The load goes through the app's real collector and queue
    Given the benchmark is set up to run
    When it sends spans
    Then they arrive through the same ingestion endpoint a customer SDK uses
    And they are carried by the real queue the platform runs in production
    And no read model is written directly

  @ci @preflight @unit
  Scenario: A run with nothing draining the queue is not reported as data loss
    Given the platform is running without a worker to drain the queue
    When the benchmark starts
    Then it stops before sending the workload
    And it reports that the benchmark could not run, naming the missing worker
    And it does not claim the pipeline lost spans

  @ci @reporting @unit
  Scenario: A benchmark that could not run is not reported as a passing run
    Given the driver cannot reach ClickHouse
    When the run ends
    Then it reports that it could not run, distinctly from finding a violation
    And nobody can read the result as evidence the pipeline is correct

  @ci @reporting @unit
  Scenario: A run that finds a violation is distinguishable from a broken run
    Given the pipeline lost spans under load
    When the run ends
    Then it reports a correctness failure naming the affected traces
    And the report separates it from a benchmark that failed to execute

  @ci @reporting @unit
  Scenario: A pipeline that never caught up is inconclusive, not lost data
    Given a stage gives up waiting for the pipeline to catch up
    And the only shortfalls it then finds are counts that lag would explain
    When the run ends
    Then it reports the run as inconclusive rather than as a correctness failure
    And it tells the reader to re-run with a longer settle timeout
    And a slow ingestion path is never reported as data loss

  @ci @reporting @unit
  Scenario: A violation lag cannot explain still fails a run that never settled
    Given a stage gives up waiting for the pipeline to catch up
    And one tenant's spans were stored under another tenant's id
    When the run ends
    Then it reports a correctness failure
    And waiting longer is not offered as an explanation

  # ---------------------------------------------------------------------------
  # Stage 1 — serial stream. The fold hot path and per-aggregate FIFO.
  # ---------------------------------------------------------------------------

  @stage-serial @correctness @e2e @unimplemented
  Scenario: A long serial trace stores every span exactly once
    Given one trace whose spans arrive sequentially
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count
    And the trace's summary counts each span exactly once

  # ---------------------------------------------------------------------------
  # Stage 2 — concurrent influx. Dispatch fairness and the per-tenant soft cap.
  # ---------------------------------------------------------------------------

  @stage-concurrent @correctness @e2e @unimplemented
  Scenario: Concurrent traces across tenants all land intact
    Given many traces ingesting at once across several tenants
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count
    And each trace's summary counts each of its spans exactly once
    And no tenant is starved of dispatch for the whole stage

  # ---------------------------------------------------------------------------
  # Stage 3 — adversarial. The stage most likely to find a real bug.
  # ---------------------------------------------------------------------------

  @stage-adversarial @correctness @unit
  Scenario: Spans of one trace arriving at once are still counted exactly once
    Given one trace's spans split across requests that are all in flight together
    When the stage completes and the pipeline drains
    Then every span of that trace is counted in its summary
    And no summary counts a span twice

  @stage-adversarial @correctness @unit
  Scenario: Bursty arrival does not lose or duplicate spans
    Given spans arriving in bursts far above the steady rate
    When the stage completes and the pipeline drains
    Then the stored span count equals the accepted span count

  @stage-adversarial @correctness @unit
  Scenario: Interleaved tenants never see each other's spans
    Given several tenants ingesting interleaved traces in the same burst
    When the stage completes and the pipeline drains
    Then every stored span carries the tenant that sent it
    And no tenant's trace appears under another tenant

  @stage-adversarial @correctness @unit
  Scenario: Unusually large payloads survive the round trip
    Given spans carrying attributes far larger than the rest of the workload
    When the stage completes and the pipeline drains
    Then every one of those spans is stored
    And reading one back returns the attributes it was sent with

  # ---------------------------------------------------------------------------
  # Reporting — informational, deliberately not a gate.
  # ---------------------------------------------------------------------------

  @reporting @unit
  Scenario: Each stage reports its resource usage as a job summary
    When the benchmark finishes
    Then a per-stage markdown table shows throughput and peak CPU and memory
    And the raw samples are uploaded as an artifact

  @reporting @unit
  Scenario: Resource usage never fails the run on an absolute threshold
    Given a stage whose CPU or memory reading is far above the previous run
    When the benchmark finishes
    Then the run does not fail on that reading alone
    And the reading is reported for a human to judge

  @reporting @unit
  Scenario: A correctness violation fails the run
    Given a stage where stored spans do not match accepted spans
    When the benchmark finishes
    Then the run fails
    And the summary names the stage and the mismatch

  # ---------------------------------------------------------------------------
  # Bounding — a run that dies on a full volume tells you nothing.
  # ---------------------------------------------------------------------------

  @bounds @unit
  Scenario: A workload too large for the runner is refused before it starts
    Given the runner has a small disk shared with the cluster and the build
    When someone asks for a workload that would not fit on it
    Then the run is refused while planning, before a single span is sent
    And the refusal says how much the workload would have written
