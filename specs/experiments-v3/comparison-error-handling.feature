Feature: Comparison error handling

  Background:
    Given an Experiments Workbench has a Comparison target
    And the Comparison target uses an LLM judge model

  @unit
  Scenario: Judge auth failures are serialized as domain errors
    When the judge call fails with a 403 missing authentication token error
    Then the evaluator result includes a domain error with kind "evaluator_execution_error"
    And the domain error meta includes httpStatus 403
    And the raw provider response remains available in the result details

  @integration
  Scenario: The Comparison cell renders a friendly auth failure
    Given a Comparison cell result contains an evaluator execution domain error with httpStatus 403
    When the cell renders the error
    Then it shows "Missing or invalid model API key"
    And it shows the AI Gateway configuration hint
    And it does not dump the raw status-code response as the headline
