Feature: CI exit gate for platform experiment runs
  As a developer running a platform experiment from CI
  I want the job to fail when the run breaks, and on failed evaluations when I ask
  So that a quality drop can stop a merge without turning existing green CI red

  # Default exit codes do not change. The SDKs fail on an errored cell; the CLI fails
  # only on a run the server marks failed. Failing on evaluations is opt-in:
  #   Python  result.print_summary(fail_on_evaluator_failures=True)
  #   TS      result.printSummary({ failOnEvaluatorFailures: true })
  #   CLI     langwatch experiment run <slug> --wait --fail-on-evaluator-failures
  # The opt-in counts a crashed evaluator as a failure: it checked nothing.
  # The gate reads the per-evaluator tallies in the run summary
  # (modules/experiment/specs/experiment-run-summary-verdicts.feature).

  Background:
    Given a platform experiment "quality-check" with one evaluator

  @unit
  Scenario: run() sends every input override in the start request
    When I call run("quality-check") with data, parameters, rowIndices and concurrency
    Then the start request body carries data, parameters, row_indices and concurrency

  @unit
  Scenario: By default an errored cell fails the job
    Given a completed run with 1 errored cell
    When the summary is printed with the default options
    Then the process exits with code 1

  @unit
  Scenario: By default a failed evaluation leaves the job green
    Given a completed run with no errored cell and 1 failed evaluation
    When the summary is printed with the default options
    Then the process does not exit

  @unit
  Scenario: Opting in fails the job on a failed evaluation
    Given a completed run with no errored cell and 1 failed evaluation
    When the summary is printed with fail on evaluator failures
    Then the process exits with code 1

  @unit
  Scenario: Opting in still passes a run whose evaluations all passed
    Given a completed run with no errored cell and every evaluation passed
    When the summary is printed with fail on evaluator failures
    Then the process does not exit

  @unit
  Scenario: Opting in fails the job when an evaluator crashed on every row
    Given a completed run with no errored cell and an evaluator that errored on every row
    When the summary is printed with fail on evaluator failures
    Then the process exits with code 1

  @unit
  Scenario: By default a crashed evaluator leaves the job green
    Given a completed run with no errored cell and an evaluator that errored on every row
    When the summary is printed with the default options
    Then the process does not exit

  @unit
  Scenario: Opting in against a server without tallies keeps the cell gate
    Given a completed run whose summary carries cell counts only
    When the summary is printed with fail on evaluator failures
    Then the process does not exit

  @unit
  Scenario: Turning exit off wins over the opt-in
    Given a completed run with 1 errored cell and 1 failed evaluation
    When the summary is printed with exit on failure off and fail on evaluator failures
    Then the process does not exit

  @unit
  Scenario: The CLI leaves a completed run green by default, as before
    Given a completed run with 1 errored cell and 1 failed evaluation
    When I run "langwatch experiment run quality-check --wait"
    Then the command exits with code 0

  @unit
  Scenario: The CLI fails a waited run on a failed evaluation when asked
    Given a completed run with no errored cell and 1 failed evaluation
    When I run "langwatch experiment run quality-check --wait --fail-on-evaluator-failures"
    Then the run document is printed
    And the command exits with code 1

  @unit
  Scenario: The CLI opt-in also fails a waited run on an errored cell
    Given a completed run with 1 errored cell and no failed evaluation
    When I run "langwatch experiment run quality-check --wait --fail-on-evaluator-failures"
    Then the command exits with code 1

  @unit
  Scenario: The CLI opt-in fails a waited run whose evaluator crashed
    Given a completed run with no errored cell and an evaluator that errored on every row
    When I run "langwatch experiment run quality-check --wait --fail-on-evaluator-failures"
    Then the command exits with code 1

  @unit
  Scenario: The CLI opt-in leaves a clean run green
    Given a completed run with no errored cell and every evaluation passed
    When I run "langwatch experiment run quality-check --wait --fail-on-evaluator-failures"
    Then the command exits with code 0

  @unit
  Scenario: The evaluator flag without --wait is rejected
    When I run "langwatch experiment run quality-check --fail-on-evaluator-failures"
    Then the command reports that the flag needs --wait
    And no run is started
    And the command exits with code 1

  @unit
  Scenario: A run that fails on the server fails the job
    Given the run ends with status "failed"
    When I run "langwatch experiment run quality-check --wait"
    Then the command exits with code 1
