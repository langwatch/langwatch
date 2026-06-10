Feature: Trigger workflow evaluations via the API with parameters
  As a platform engineer wiring evaluations into CI
  I want to trigger a workflow evaluation through the REST API and pass parameters
  So that runs configured on the platform can be launched from pipelines without
  hardcoding values in the agent

  # Customer context: experiments built in the studio could only be
  # evaluated from the Evaluate button; CI pipelines that let users pick
  # a PR number / feature flag / variant had no way to launch them or to
  # feed those values in. Parameters bind as constant entry inputs for
  # every dataset row — pairing with the entry point's user-defined
  # inputs (see entry-point-node.feature).

  Background:
    Given a project API key with workflow permissions
    And a workflow with a committed version and an attached dataset

  @integration
  Scenario: Triggering an evaluation returns a run id
    When I POST to the workflow's evaluate endpoint
    Then the response carries a run id and the evaluated version
    And the evaluation executes against the workflow's dataset

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
  Scenario: Parameters bind as constant entry inputs across all rows
    Given the dataset has 3 rows
    When I POST with parameters {"feature_flag": "variant-b"}
    Then every evaluated row's entry carries feature_flag = "variant-b"
    And the entry point exposes "feature_flag" as an input field

  @integration
  Scenario: Parameters alone evaluate a single synthetic row
    Given the workflow's entry point has no dataset attached
    When I POST with parameters {"query": "hello"}
    Then the evaluation runs over one row built from the parameters

  @integration
  Scenario: Unknown workflow returns not found
    When I POST to the evaluate endpoint of a workflow id from another project
    Then the response is a 404

  @integration
  Scenario: A workflow with no committed version cannot be evaluated
    Given a workflow that was never committed
    When I POST to its evaluate endpoint
    Then the response is a 400 explaining a version must be committed first
