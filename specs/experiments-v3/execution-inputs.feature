Feature: An evaluation run accepts inline data, a dataset id, or parameters
  As a caller running an evaluation from CI, a script, or an SDK
  I want to pass the data to evaluate directly, or reference a platform dataset,
  And to set constant inputs that apply to every row
  So that I do not have to pre-attach a dataset or add a column just to set a flag.

  # These inputs are accepted by both the experiments-v3 run endpoint and the
  # workflow evaluate endpoint, normalized into the existing dataset shape
  # before the orchestrator runs.

  @integration @unimplemented
  Scenario: Inline data rows run without a saved dataset
    Given a target with no attached dataset
    When I run the evaluation passing two inline data rows
    Then exactly two rows are evaluated from the inline data

  @integration @unimplemented
  Scenario: A dataset id loads a platform dataset and evaluates every row
    Given a saved platform dataset with four rows
    When I run the evaluation passing that dataset id
    Then four rows are evaluated from the saved dataset

  @unit
  Scenario: Parameters bind as constant columns overriding entry fields on every row
    Given a dataset with a column "question" and three rows
    When I run the evaluation with parameters setting "feature_flag" to "variant-b"
    Then every evaluated row has "feature_flag" equal to "variant-b"
    And the original "question" values are preserved

  @unit
  Scenario: A parameter that names a dataset column overrides it for every row
    Given a dataset with a column "model" whose rows vary
    When I run the evaluation with parameters setting "model" to "gpt-5-mini"
    Then every evaluated row has "model" equal to "gpt-5-mini"

  @unit
  Scenario: Parameters with no dataset evaluate a single synthetic row
    Given a target with no attached dataset and no inline data
    When I run the evaluation with parameters only
    Then exactly one synthetic row is evaluated containing those parameters

  @integration @unimplemented
  Scenario: Row indices run a subset of the dataset
    Given a dataset with five rows
    When I run the evaluation requesting row indices 0 and 2
    Then exactly the first and third rows are evaluated

  @unit
  Scenario: Passing both inline data and a dataset id is rejected
    When a run request supplies both data and a dataset id
    Then the request is rejected before any execution

  # A saved dataset is read page by page on the server. A run covers every row
  # of it or is refused: it never reports success over fewer rows than the
  # dataset has. The row limit a plan sets applies to rows sent in the request,
  # a saved dataset answers the dataset row limit instead.

  @unit
  Scenario: A saved dataset larger than one inline response runs every row
    Given a saved dataset of 40 rows of 200 KB each
    When I run the evaluation passing that dataset id
    Then all 40 rows are loaded for the run

  @unit
  Scenario: A saved dataset with more rows than the plan sends inline runs every row
    Given a free plan, which sends at most 1,000 rows inline
    And a saved dataset of 2,500 rows
    When I run the evaluation against that saved dataset
    Then all 2,500 rows are loaded for the run

  @unit
  Scenario: Inline rows above the plan's inline row limit are refused naming that limit
    Given a free plan, which sends at most 1,000 rows inline
    When I run the evaluation passing 1,001 inline data rows
    Then the run is refused as "experiment_evaluation_too_many_rows"
    And the refusal names the 1,000 row limit and saving the rows as a dataset

  @unit
  Scenario: A saved dataset above the dataset row limit is refused before its rows are read
    Given a saved dataset with more rows than one run reads
    When I run the evaluation against that saved dataset
    Then the run is refused as "experiment_dataset_too_many_rows"
    And no page of rows is read

  @unit
  Scenario: A saved dataset whose rows total more than a run holds is refused
    Given a saved dataset whose rows total more bytes than the organization's whole-dataset limit
    When I run the evaluation against that saved dataset
    Then the run is refused as "experiment_dataset_too_large_to_run"
    And the refusal names the limit and storing images as attachments

  @unit
  Scenario: An organization with a raised file limit runs a dataset the default limit refuses
    Given an organization whose whole-dataset limit was raised
    And a saved dataset larger than the default limit and smaller than the raised one
    When I run the evaluation against that saved dataset
    Then every row is loaded for the run

  @unit
  Scenario: A saved dataset that changes while the run reads it is refused instead of run short
    Given a saved dataset that loses rows after the run starts reading it
    When I run the evaluation against that saved dataset
    Then the run is refused as "experiment_dataset_changed_during_read"

