Feature: Experiment run totals are derived from its items
  An experiment run records the details that belong to the run itself — what
  was run, against what, and when it started, stopped or finished. Its counts,
  costs and scores are computed from the run's items at read time. (ADR-103.)
  Scenarios marked @unimplemented are the parts of that ADR the read path has
  not taken over yet; each one names what still stands in the way.

  Background:
    Given an experiment with a dataset and evaluators

  # --- What the run itself holds ---

  @unit
  Scenario: Run-level details survive with no items
    Given an experiment run that was started and then stopped before any item completed
    When the user opens the run
    Then the experiment, the targets and the expected total are reported
    And the run is reported as stopped

  # `experiment_runs` is partitioned by the run's start, so a start that moves
  # files one run in two partitions, and a ReplacingMergeTree never collapses
  # two versions that landed in different ones.
  @unit
  Scenario: A run's start time is frozen at the first start it observed
    Given an experiment run that was started
    When a further started event arrives carrying an earlier time
    Then the run still reports the start time it was first given
    And the stored row is never stamped from the clock of whoever wrote it

  # --- Derivation ---

  @unit
  Scenario: Progress and outcomes reflect the run's items
    Given an experiment run whose items have partly completed
    When the user opens the run
    Then the completed and failed counts match its items
    And the total cost and duration are summed from those items
    And the average score and pass rate are computed from the graded items

  # The run row keeps no counters at all — no `CompletedCount`, no
  # `TotalScoreSum`, no applied-event-id watermark (ADR-098 decision 5;
  # ADR-103 decision 1). Each item is its own row keyed by its natural
  # identity, so a redelivered result collapses onto the same row instead of
  # adding a second one, and the run's counts are a query over those rows at
  # read time. There is nothing to re-derive on a cold cache, because there is
  # nothing cached to fall behind: the "11/10"-beside-ten-items drift this once
  # produced was a property of the old incremental counter, not of the item
  # rows that replaced it.
  @unit
  Scenario: A repeated item result does not inflate the run
    Given an experiment run with one completed item
    When that item's result is recorded more than once
    Then the run still reports one completed item
    And its cost is counted once

  # --- Cost ---
  #
  # Costs reach a run by two routes. An experiment that reports its own costs
  # carries them on the item. An SDK experiment reports none, and the cost is
  # only known once the trace it produced has been priced from its spans.

  @unit
  Scenario: An item that reports its own cost keeps that figure
    Given an experiment run whose items were recorded with costs
    When the user opens the run
    Then each item reports the cost it was recorded with

  @integration
  Scenario: An item with no cost of its own is priced from its trace
    Given an experiment run whose items were recorded without costs
    And each item recorded the trace it produced
    When the user opens the run
    Then each item reports the cost of its trace

  # A trace's price now reaches the RUN TOTAL as well as the items. Both
  # derivations go through one rule — `splitTraceCostAcrossTargets` over one
  # `fetchTraceCosts` lookup — so the footer and the table cannot disagree.
  # `enrichRunsWithBreakdownAndCosts` still starts from
  # `sumIf(TargetCost, …)` over the item rows, then adds what the run's
  # cost-less targets are worth from the traces they produced; a target that
  # priced itself is left alone, because a trace price and an inline price are
  # alternative sources for one figure rather than addends. A run with no
  # cost-less traced item skips the two extra reads entirely.

  @unit
  Scenario: Several targets sharing one trace split its cost
    Given an experiment run with two targets whose executions share a trace
    When the user opens the run
    Then the trace's cost is divided evenly between them
    And the run's total counts that trace's cost once

  @unit
  Scenario: A trace priced after the run finished is still counted
    Given an experiment run reported as finished
    And one of its traces is priced afterwards
    When the user opens the run
    Then the run's total includes that trace's cost

  @unit
  Scenario: A trace repriced upwards reports the newer figure
    Given an experiment run whose trace has been priced
    When further spans arrive and the trace is repriced higher
    And the user opens the run
    Then the run reports the newer figure
    And it reports the same figure however many times the run is read

  # --- Lateness ---

  @unit
  Scenario: A late item changes the run immediately
    Given an experiment run reported as finished
    When a further item result is recorded for it
    Then the run's totals include that item on the next read
