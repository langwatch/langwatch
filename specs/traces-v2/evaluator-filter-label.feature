Feature: Evaluator filter label
  As an operator filtering traces by evaluator
  I want the evaluator filter rows labelled by name, not by type
  So that the limited sidebar width goes to the part that disambiguates

  # A project's evaluators are mostly the same type, so a leading
  # `[workflow]` / `[langevals/llm_category]` pill repeated the same
  # token down the whole list while truncating the names that actually
  # tell evaluators apart.

  @unit
  Scenario: Evaluator facet labels drop the type prefix
    Given the evaluator facet query is built
    Then the projected label is the evaluator name (or id) without a bracketed type prefix
    And the facet value remains the evaluator id so saved queries round-trip
