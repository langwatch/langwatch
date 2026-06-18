# @unimplemented while this PR is in flight: scenarios are bound (and the
# @unimplemented tag dropped) as the phase implementing them lands.
@unimplemented
Feature: An evaluation run accepts inline data, a dataset id, or parameters
  As a caller running an evaluation from CI, a script, or an SDK
  I want to pass the data to evaluate directly, or reference a platform dataset,
  And to set constant inputs that apply to every row
  So that I do not have to pre-attach a dataset or add a column just to set a flag.

  # These inputs are accepted by both the experiments-v3 run endpoint and the
  # workflow evaluate endpoint, normalized into the existing dataset shape
  # before the orchestrator runs.

  @integration
  Scenario: Inline data rows run without a saved dataset
    Given a target with no attached dataset
    When I run the evaluation passing two inline data rows
    Then exactly two rows are evaluated from the inline data

  @integration
  Scenario: A dataset id loads a platform dataset and evaluates every row
    Given a saved platform dataset with four rows
    When I run the evaluation passing that dataset id
    Then four rows are evaluated from the saved dataset

  @integration
  Scenario: Parameters bind as constant columns overriding entry fields on every row
    Given a dataset with a column "question" and three rows
    When I run the evaluation with parameters setting "feature_flag" to "variant-b"
    Then every evaluated row has "feature_flag" equal to "variant-b"
    And the original "question" values are preserved

  @integration
  Scenario: A parameter that names a dataset column overrides it for every row
    Given a dataset with a column "model" whose rows vary
    When I run the evaluation with parameters setting "model" to "gpt-5-mini"
    Then every evaluated row has "model" equal to "gpt-5-mini"

  @integration
  Scenario: Parameters with no dataset evaluate a single synthetic row
    Given a target with no attached dataset and no inline data
    When I run the evaluation with parameters only
    Then exactly one synthetic row is evaluated containing those parameters

  @integration
  Scenario: Row indices run a subset of the dataset
    Given a dataset with five rows
    When I run the evaluation requesting row indices 0 and 2
    Then exactly the first and third rows are evaluated

  @unit
  Scenario: Passing both inline data and a dataset id is rejected
    When a run request supplies both data and a dataset id
    Then the request is rejected before any execution
