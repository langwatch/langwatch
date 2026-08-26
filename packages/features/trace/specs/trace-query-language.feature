Feature: Trace query language

  Scenario: Browser editing uses the canonical language locally
    Given a trace filter contains fields, boolean groups, ranges, or free text
    When the browser parses, analyses, or mutates the filter
    Then it uses the portable Trace contract without a server round trip
    And serialization preserves the existing query meaning and ordering

  Scenario: Evaluator conditions stay scoped to one evaluator
    Given two evaluator filters are active
    When a verdict, label, or score condition changes for one evaluator
    Then the condition remains inside that evaluator's group
    And the other evaluator's conditions remain unchanged

  Scenario: AI query prompts include live categorical examples
    Given the Trace service can read categorical values for the project and time range
    When it builds the query field catalogue
    Then live values appear before static values without duplicates
    And one failed facet read omits only that facet's live examples
