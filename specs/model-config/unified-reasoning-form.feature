Feature: Unified Reasoning Form Field
  As a user configuring LLM parameters
  I want to see a single "Reasoning" field in forms
  So that I have a consistent experience across all providers

  # Form Schema Validation
  @unit
  Scenario: Form schema accepts reasoning field with valid value
    Given a prompt config form
    When I set llm.reasoning to "high"
    Then the form should validate successfully

  @unit
  Scenario: Form schema accepts reasoning field with "low" value
    Given a prompt config form
    When I set llm.reasoning to "low"
    Then the form should validate successfully

  @unit
  Scenario: Form schema accepts reasoning field with "medium" value
    Given a prompt config form
    When I set llm.reasoning to "medium"
    Then the form should validate successfully

  @unit
  Scenario: Form schema accepts undefined reasoning
    Given a prompt config form
    When I do not set llm.reasoning
    Then the form should validate successfully

  # Form to Save Params Conversion
  @unit
  Scenario: formValuesToTriggerSaveVersionParams includes reasoning
    Given form values with llm.reasoning "high"
    When converting to save params
    Then the result should include reasoning "high"
    And the result should NOT include reasoningEffort
    And the result should NOT include thinkingLevel
    And the result should NOT include effort

  @unit
  Scenario: formValuesToTriggerSaveVersionParams handles undefined reasoning
    Given form values with no llm.reasoning set
    When converting to save params
    Then the result should have reasoning undefined
    And the result should NOT include reasoningEffort

  # Versioned Prompt to Form Values Conversion
  @unit
  Scenario: versionedPromptToPromptConfigFormValues maps reasoning correctly
    Given a versioned prompt with reasoning "high"
    When converting to form values
    Then the form should have llm.reasoning "high"

  @unit
  Scenario: versionedPromptToPromptConfigFormValues handles missing reasoning
    Given a versioned prompt with no reasoning
    When converting to form values
    Then the form should have llm.reasoning undefined

  # Round-trip Consistency
  @integration
  Scenario: Form values round-trip preserves reasoning
    Given form values with llm.reasoning "medium"
    When converting to save params and back to form values
    Then the form should have llm.reasoning "medium"
