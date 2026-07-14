Feature: Server-side experiment run returns per-row results
  As a Python developer running a platform experiment from CI
  I want to pass my data and get a pandas DataFrame of per-row results back
  So that I can analyze the run inline without reconstructing the results URL by hand.

  Background:
    Given a valid LangWatch API key
    And a platform experiment "rag-eval" with an attached dataset

  @integration
  Scenario: Running with the attached dataset returns a DataFrame and a run url
    When I run the experiment "rag-eval"
    Then the result exposes a run_url pointing at the experiment results page
    And the result exposes a pandas DataFrame with one row per dataset entry
    And the DataFrame has an "output" column and a "trace_id" column
    And each evaluator contributes a score column and a passed column

  @integration
  Scenario: Inline data overrides the attached dataset
    When I run the experiment "rag-eval" passing two inline data rows
    Then exactly two rows are evaluated
    And the request body contains the inline data and no dataset id

  @integration
  Scenario: A dataset id loads a platform dataset
    When I run the experiment "rag-eval" passing a dataset id
    Then the request body contains the dataset id and no inline data

  @unit
  Scenario: Passing both inline data and a dataset id is rejected
    When I run the experiment with both inline data and a dataset id
    Then a ValueError is raised before any HTTP call

  @unit
  Scenario: Parameters are applied as constants to every row
    When I run the experiment with parameters setting a model
    Then the request body parameters contain that model

  @integration
  Scenario: A missing dataset id surfaces a clear error
    When I run the experiment passing a dataset id that does not exist
    Then an error is raised that names the dataset id
