Feature: Prompt optimization entry points
  The workbench hands a prompt column to Langy in one gesture, and the
  handoff carries the context Langy needs to run the improvement loop.

  Background:
    Given an evaluations workbench with a prompt target column

  @integration
  Scenario: The prompt column menu offers Optimize this prompt on prompt targets only
    When the user opens a prompt column's menu
    Then "Optimize this prompt" is the first item
    And an evaluator column's menu does not offer it

  @integration
  Scenario: Choosing Optimize opens the Langy panel and auto-sends the optimize request
    When the user chooses "Optimize this prompt"
    Then the Langy panel opens
    And the optimize request is queued to send without further typing
    And the request names the column and tells Langy to work on a duplicate

  @integration
  Scenario: The optimize handoff carries the experiment and prompt context chips
    When the user chooses "Optimize this prompt"
    Then the experiment chip the page offers is chosen
    And the column's prompt is absorbed as picked context
