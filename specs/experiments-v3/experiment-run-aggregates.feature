Feature: Experiment run totals are derived from its items
  An experiment run records the facts that belong to the run itself — what was
  run, against what, and when it started, stopped or finished. Its counts,
  costs and scores are computed from the run's items at read time. (ADR-061.)

  Background:
    Given an experiment with a dataset and evaluators

  # --- What the run itself holds ---

  Scenario: Run-level facts survive with no items
    Given an experiment run that was started and then stopped before any item completed
    When the user opens the run
    Then the experiment, the targets and the expected total are reported
    And the run is reported as stopped

  # --- Derivation ---

  Scenario: Progress and outcomes reflect the run's items
    Given an experiment run whose items have partly completed
    When the user opens the run
    Then the completed and failed counts match its items
    And the total cost and duration are summed from those items
    And the average score and pass rate are computed from the graded items

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

  Scenario: An item that reports its own cost keeps that figure
    Given an experiment run whose items were recorded with costs
    When the user opens the run
    Then each item reports the cost it was recorded with

  Scenario: An item with no cost of its own is priced from its trace
    Given an experiment run whose items were recorded without costs
    And each item recorded the trace it produced
    When the user opens the run
    Then each item reports the cost of its trace

  Scenario: Several targets sharing one trace split its cost
    Given an experiment run with two targets whose executions share a trace
    When the user opens the run
    Then the trace's cost is divided evenly between them
    And the run's total counts that trace's cost once

  Scenario: A trace priced after the run finished is still counted
    Given an experiment run reported as finished
    And one of its traces is priced afterwards
    When the user opens the run
    Then the run's total includes that trace's cost

  Scenario: A trace repriced upwards reports the newer figure
    Given an experiment run whose trace has been priced
    When further spans arrive and the trace is repriced higher
    When the user opens the run
    Then the run reports the newer figure
    And it reports the same figure however many times the run is read

  # --- Lateness ---

  Scenario: A late item changes the run immediately
    Given an experiment run reported as finished
    When a further item result is recorded for it
    Then the run's totals include that item on the next read
