Feature: Suite (run plan) REST API completeness
  As a user managing simulations as code
  I want the suites REST API to expose the same fields the UI edits
  So that a run plan managed through the API keeps its model overrides

  Background:
    Given I am authenticated with a project API key

  @integration
  Scenario: Create over REST accepts run-plan model overrides
    When I POST a suite with simulatorModel "openai/gpt-5-mini" and judgeModel "openai/latest"
    Then the response carries those values back
    And GET on the suite returns the same values

  @integration
  Scenario: Update over REST clears a run-plan model override with null
    Given a suite with a judge model override
    When I PATCH the suite with judgeModel null
    Then the stored override is cleared
    And GET on the suite returns judgeModel null

  @integration
  Scenario: PUT updates a suite the same way PATCH does
    Given a suite exists
    When I PUT the suite with a new name
    Then the response is 200 and carries the new name

  @integration
  Scenario: REST rejects a run-plan model override with no provider prefix
    When I POST a suite with judgeModel "gpt-5-mini"
    Then the response is a validation error
