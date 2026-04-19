Feature: Python SDK Experiment.print_summary for CI/CD parity
  As a Python SDK user running experiments in CI
  I want experiment.print_summary() on SDK-driven experiments (not only on ExperimentRunResult)
  So that SDK-defined experiments can fail CI builds the same way platform experiments do

  Background:
    Given a LangWatch client initialized with a valid API key
    And an experiment instance created via langwatch.experiment.init("ci-quality-check")

  # --- Parity with ExperimentRunResult ---

  @unit
  Scenario: print_summary prints a CI-friendly summary after loop completes
    Given the experiment has looped over a dataset and recorded evaluations
    When I call experiment.print_summary(exit_on_failure=False)
    Then stdout contains the run ID
    And stdout contains the total passed and failed counts
    And stdout contains the pass rate
    And stdout contains the run URL
    And the process does not exit

  @unit
  Scenario: print_summary exits with code 1 when any evaluation failed and exit_on_failure is True
    Given the experiment has at least one failed evaluation
    When I call experiment.print_summary(exit_on_failure=True)
    Then SystemExit is raised with code 1

  @unit
  Scenario: print_summary does not exit when exit_on_failure is False even with failures
    Given the experiment has at least one failed evaluation
    When I call experiment.print_summary(exit_on_failure=False)
    Then no SystemExit is raised
    And stdout still reports the failure count

  @unit
  Scenario: print_summary does not exit when all evaluations passed
    Given every evaluation in the experiment passed
    When I call experiment.print_summary(exit_on_failure=True)
    Then no SystemExit is raised
    And stdout reports a 100% pass rate

  @unit
  Scenario: print_summary defaults to exit_on_failure=True outside a notebook
    Given the experiment is running in a non-notebook Python process
    And the experiment has a failed evaluation
    When I call experiment.print_summary() with no arguments
    Then SystemExit is raised with code 1

  @unit
  Scenario: print_summary defaults to exit_on_failure=False inside a Jupyter notebook
    Given the experiment is running inside a Jupyter notebook (IPython kernel)
    And the experiment has a failed evaluation
    When I call experiment.print_summary() with no arguments
    Then no SystemExit is raised

  # --- Edge cases ---

  @unit
  Scenario: print_summary handles an experiment with no evaluations gracefully
    Given the experiment has looped but no evaluations were recorded
    When I call experiment.print_summary(exit_on_failure=False)
    Then stdout reports zero evaluations
    And no SystemExit is raised

  @unit
  Scenario: print_summary reports per-evaluator breakdown
    Given the experiment ran with evaluators "faithfulness" and "relevance"
    When I call experiment.print_summary(exit_on_failure=False)
    Then stdout contains a row for "faithfulness"
    And stdout contains a row for "relevance"
