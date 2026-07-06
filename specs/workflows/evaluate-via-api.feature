Feature: Trigger workflow evaluations via the API
  As a platform engineer wiring evaluations into CI
  I want to trigger a workflow evaluation through the REST API
  So that runs configured in the studio can be launched from pipelines and read back

  # Customer context: experiments built in the studio could only be evaluated
  # from the Evaluate button; CI pipelines had no way to launch them, pass a
  # PR number / feature flag / variant, or read the results back. The endpoint
  # now runs through the same evaluations-v3 pipeline as the run API and returns
  # a results URL. Parameters bind as constant inputs for every dataset row.

  Background:
    Given a project API key with workflow permissions
    And a workflow with a committed version and an attached dataset

  @integration
  Scenario: Triggering an evaluation returns a run id and a results url
    When I POST to the workflow's evaluate endpoint
    Then the response carries a run id and a results url for the run
    And the workflow's evaluation experiment exists

  @integration
  Scenario: The response stays backward compatible
    When I POST to the workflow's evaluate endpoint
    Then the response still carries the evaluated version id and version

  @integration
  Scenario: The latest committed version is evaluated by default
    Given the workflow has versions 1 and 2 committed
    When I POST to the evaluate endpoint without a version
    Then version 2 is the one evaluated

  @integration
  Scenario: A specific committed version can be requested
    Given the workflow has versions 1 and 2 committed
    When I POST with version 1's id
    Then version 1 is the one evaluated

  @integration
  Scenario: Caller-supplied parameters are accepted
    When I POST with parameters that set a feature flag
    Then the run starts and a results url is returned

  @integration
  Scenario: Inline data can be evaluated instead of the attached dataset
    When I POST with inline data rows
    Then the run starts and a results url is returned

  @integration
  Scenario: The endpoint rejects inline data and a dataset id together
    When I POST with both inline data and a dataset id
    Then the response is a 400

  @integration
  Scenario: Unknown workflow returns not found
    When I POST to the evaluate endpoint of a workflow id from another project
    Then the response is a 404

  @integration
  Scenario: A workflow with no committed version cannot be evaluated
    Given a workflow that was never committed
    When I POST to its evaluate endpoint
    Then the response is a 400 explaining a version must be committed first
