Feature: Server-side workflow run returns per-row results
  As a Python developer evaluating a platform workflow from CI
  I want to run a workflow by id and get the same per-row DataFrame as an experiment run
  So that workflows and experiments feel like one API returning one result shape.

  Background:
    Given a valid LangWatch API key
    And a committed workflow with an attached dataset

  @integration
  Scenario: Running a workflow returns a DataFrame and a run url
    When I run the workflow by id
    Then the result exposes a run_url pointing at the workflow's experiment results page
    And the result exposes a pandas DataFrame with the same columns an experiment run returns

  @integration
  Scenario: Inline data evaluates without a saved dataset
    When I run the workflow by id passing two inline data rows
    Then exactly two rows are evaluated

  @integration
  Scenario: A dataset id loads a platform dataset
    When I run the workflow by id passing a dataset id
    Then the dataset's rows are evaluated

  @unit
  Scenario: Parameters override the entry fields on every row
    When I run the workflow with parameters setting a feature flag
    Then the request body parameters contain that feature flag

  @unit
  Scenario: Passing both inline data and a dataset id is rejected
    When I run the workflow with both inline data and a dataset id
    Then a ValueError is raised before any HTTP call
