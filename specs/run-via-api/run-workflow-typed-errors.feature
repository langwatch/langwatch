@integration
Feature: Running a workflow via the API surfaces typed errors
  As an agent or script calling POST /api/workflows/:workflowId/run
  I want a 404 for a missing workflow and a 422 for an unpublished one
  So that I can tell "fix your request" apart from "something broke on your end"

  # Implementation:
  #   langwatch/src/server/workflows/runWorkflow.ts
  #   langwatch/src/server/routes/misc.ts  (handleWorkflowRun — must not
  #     swallow the typed error into a flat 500)

  Scenario: Running a nonexistent workflow returns 404
    Given no workflow exists with the given id
    When the agent calls POST /api/workflows/:workflowId/run
    Then the response status is 404
    And the response is not a generic 500

  Scenario: Running a workflow that has never been published returns 422
    Given a workflow exists but has never been published
    When the agent calls POST /api/workflows/:workflowId/run
    Then the response status is 422
    And the response is not a generic 500

  Scenario: An untyped runWorkflow error still returns a safe 500, not a leaked message
    Given runWorkflow throws an error that isn't one of the typed error classes
    When the agent calls POST /api/workflows/:workflowId/run
    Then the response status is 500
    And the response does not contain the internal error message
