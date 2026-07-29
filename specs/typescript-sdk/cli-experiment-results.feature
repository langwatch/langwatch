Feature: CLI evaluation results command
  As an engineer or coding agent debugging an evaluation
  I want to fetch per-row results for an experiment from the CLI
  So that I can inspect evaluator scores and missed rows without leaving my terminal

  Background:
    Given I have a valid API key configured
    And the LangWatch API is reachable

  @integration @unimplemented
  Scenario: User views the latest run of an experiment as a table
    Given an experiment whose latest run has several rows
    When I run `langwatch experiment results <experiment>`
    Then the CLI shows results from the most recent run of the experiment
    And the CLI prints a table with one row per dataset entry
    And each row shows the row index and the key evaluator scores
    And the table is truncated to the default row limit
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User pins a specific run by id
    Given an experiment with more than one run
    When I run `langwatch experiment results <experiment> --run-id <runId>`
    Then the CLI shows results from the run identified by the provided run id
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: A row whose only failure is the comparison is still a failed row
    Given every target on a row produced output and passed its own evaluations
    But the comparison judging that row errored
    When I run `langwatch experiment results <experiment> --filter failed`
    Then that row is shown
    And the comparison's failure is shown with it

  Scenario: User filters the table to only failed rows
    Given an experiment whose latest run has both passing and failing rows
    When I run `langwatch experiment results <experiment> --filter failed`
    Then the CLI prints only rows that errored or failed an evaluation
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User narrows the table to a specific evaluator
    Given an experiment whose latest run has multiple evaluators
    When I run `langwatch experiment results <experiment> --evaluator quality`
    Then the table only displays the "quality" evaluator's column
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User pipes the full payload as JSON
    When I run `langwatch experiment results <experiment> --format json`
    Then the CLI writes the full results payload as JSON to stdout
    And the JSON output is valid and parseable
    And the CLI exits with status 0

  # A Comparison evaluator judges the whole field of targets in one verdict, so
  # its results are recorded against the comparison itself rather than against
  # any one target. The command builds its output by walking the dataset — one
  # entry per (row, target) — so anything not tied to a target had no row to
  # attach to and never reached stdout. The run summary still reported the
  # comparison, which made the omission read as "the judge produced nothing"
  # rather than "the CLI dropped it".

  @integration @unimplemented
  Scenario: A comparison verdict reaches the CLI even though it belongs to no single target
    Given an experiment whose latest run includes a Comparison evaluator over several targets
    When I run `langwatch experiment results <experiment>`
    Then the output includes the comparison's verdict for each judged row
    And each verdict names the winning target and the judge's reasoning
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: Comparison verdicts follow the rows that survive filtering
    Given an experiment whose latest run includes a Comparison evaluator
    When I run `langwatch experiment results <experiment> --limit 5`
    Then the output includes comparison verdicts only for the rows shown
    And no verdict is reported for a row that was filtered out

  @integration @unimplemented
  Scenario: Narrowing to one evaluator excludes the comparison
    Given an experiment whose latest run includes both a Comparison evaluator and a scoring evaluator
    When I run `langwatch experiment results <experiment> --evaluator quality`
    Then no comparison verdict is reported
    # The filter names one evaluator; honouring it matters more than
    # surfacing the comparison.

  @integration @unimplemented
  Scenario: User views a run that is still running
    Given an experiment whose latest run has not finished yet but has logged some rows
    When I run `langwatch experiment results <experiment>`
    Then the CLI prints the rows logged so far
    And the CLI notes that the run is still in progress and the results are partial
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User requests an experiment with no runs
    Given an experiment that has never been run
    When I run `langwatch experiment results <experiment>`
    Then the CLI prints a clear message that no runs were found
    And the CLI exits with status 1
