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

  Scenario: Per-trace cost is computed from the items
    Given an experiment run whose items span several traces
    When the user opens the run
    Then the cost attributed to each trace is summed from that trace's items
    And no per-trace record is carried on the run itself

  Scenario: A late item changes the run immediately
    Given an experiment run reported as finished
    When a further item result is recorded for it
    Then the run's totals include that item on the next read
