Feature: TypeScript SDK Experiment.printSummary for CI/CD parity
  As a TypeScript SDK user running experiments in CI
  I want experiment.printSummary() on SDK-driven experiments (not only on ExperimentRunResult)
  So that SDK-defined experiments can fail CI builds the same way platform experiments do

  Background:
    Given a LangWatch client initialized with a valid API key
    And an experiment instance created via langwatch.experiments.init("ci-quality-check")

  @unit
  Scenario: printSummary prints a CI-friendly summary after run completes
    Given the experiment has run over a dataset and recorded evaluations
    When I call experiment.printSummary({ exitOnFailure: false })
    Then stdout contains the experiment name
    And stdout contains the total passed and failed counts
    And stdout contains the pass rate
    And stdout contains the run URL
    And the process does not exit

  @unit
  Scenario: printSummary exits with code 1 when any evaluation failed and exitOnFailure is true
    Given the experiment has at least one failed evaluation
    When I call experiment.printSummary({ exitOnFailure: true })
    Then process.exit is called with code 1

  @unit
  Scenario: printSummary does not exit when exitOnFailure is false even with failures
    Given the experiment has at least one failed evaluation
    When I call experiment.printSummary({ exitOnFailure: false })
    Then process.exit is not called
    And stdout still reports the failure count

  @unit
  Scenario: printSummary does not exit when all evaluations passed
    Given every evaluation in the experiment passed
    When I call experiment.printSummary({ exitOnFailure: true })
    Then process.exit is not called
    And stdout reports a 100% pass rate
