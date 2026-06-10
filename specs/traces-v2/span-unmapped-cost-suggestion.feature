Feature: Unmapped model cost suggestion in span details
  As a user inspecting a trace
  I want to be told when a span's model has tokens but no cost mapped
  So that I can add the missing cost mapping instead of silently losing cost tracking

  @integration
  Scenario: Span with model and tokens but no cost shows a cost mapping suggestion
    Given I open the span details of a span that has a model and token counts
    And no cost was computed for that span
    Then I see a suggestion that no cost is mapped for that model
    And I see a button to add a cost mapping

  @integration
  Scenario: Suggestion opens the model costs page prefilled in a new window
    Given the cost mapping suggestion is shown for a span with model "vertex_ai/gemini-3-pro-preview"
    When I click the add cost mapping button
    Then the model costs settings page opens in a new window
    And the model cost drawer is already open
    And the model name field is prefilled with "vertex_ai/gemini-3-pro-preview"
    And the regex field is prefilled with an automatically generated exact-match regex for that model

  @integration
  Scenario: Generated regex escapes special characters
    Given the cost mapping suggestion is shown for a span with model "bedrock/eu.anthropic.claude-sonnet-4-6-v1:0"
    When I click the add cost mapping button
    Then the prefilled regex matches the literal model string
    And dots and slashes in the model name are escaped in the regex

  @integration
  Scenario: Span with a computed cost shows no suggestion
    Given I open the span details of a span that has a model, token counts, and a computed cost
    Then I do not see the cost mapping suggestion

  @integration
  Scenario: Span without token counts shows no suggestion
    Given I open the span details of a span that has a model but no token counts
    Then I do not see the cost mapping suggestion
    # without tokens there is nothing a cost rule could price
