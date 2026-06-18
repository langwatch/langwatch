# @unimplemented while this PR is in flight: scenarios are bound (and the
# @unimplemented tag dropped) as the phase implementing them lands. Bindings
# target langwatch/src/app/api/workflows/__tests__/.
@unimplemented
Feature: The workflow evaluate endpoint runs through the evaluations-v3 pipeline
  As a CI script or SDK calling POST /api/workflows/:id/evaluate
  I want the workflow evaluation to run on the unified evaluations-v3 pipeline
  And to get a results page URL back
  So that the workflow API and the experiments API are one path with one results view.

  # The endpoint keeps its URL and its existing response fields for backward
  # compatibility, and adds run_url plus inline data / dataset id inputs.

  Background:
    Given a project and a workflow with a committed version and an attached dataset

  @integration
  Scenario: Evaluating a workflow ensures an experiment exists and returns a run id and results url
    When I POST to the workflow evaluate endpoint
    Then an experiment linked to the workflow exists
    And the response includes a run id and a run_url pointing at the experiment results page

  @integration
  Scenario: The response stays backward compatible
    When I POST to the workflow evaluate endpoint
    Then the response still includes the workflow version id and the version

  @integration
  Scenario: The latest committed version is evaluated by default
    When I POST to the workflow evaluate endpoint with no version id
    Then the latest committed version is evaluated

  @integration
  Scenario: A specific committed version can be requested
    When I POST to the workflow evaluate endpoint with a version id
    Then that version is evaluated

  @integration
  Scenario: Polling mode results are fetchable by run id
    When I POST to the workflow evaluate endpoint without requesting a stream
    Then the run can be polled for status
    And the per-row results are fetchable once the run completes

  @integration
  Scenario: Stream mode emits target and evaluator events
    When I POST to the workflow evaluate endpoint requesting an event stream
    Then the stream emits target and evaluator results and a done event

  @integration
  Scenario: A workflow with no committed version cannot be evaluated
    Given a workflow with no committed version
    When I POST to the workflow evaluate endpoint
    Then the request fails with a clear bad-request error

  @integration
  Scenario: An unknown workflow returns not found
    When I POST to the workflow evaluate endpoint for a workflow that does not exist
    Then the request returns not found

  @integration
  Scenario: An in-flight workflow evaluation can be aborted
    Given a running workflow evaluation
    When the run is aborted
    Then the evaluation stops and the run is marked stopped
