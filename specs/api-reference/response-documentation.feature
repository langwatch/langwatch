Feature: A route's published answers come from its declaration

  `withOutput` and `withStatus` are the one place a route names its success
  shape, and the published reference derives the success response from them.
  A docs block may still put better words on an answer — but words are all it
  may need to add: a documented answer that states only its description keeps
  the derived content, so no route restates the schema it already declared.

  @unit
  Scenario: A documented answer with only a description keeps the declared shape
    Given a route that declares its output schema
    And its docs name the success status with a description alone
    When the route's reference documentation is published
    Then the success answer carries the docs' description
    And its content is the schema the declaration produced

  @unit
  Scenario: A documented answer that states content overrides the declared shape
    Given a route that declares its output schema
    And its docs restate the success status with their own content
    When the route's reference documentation is published
    Then the docs' content is what the reference publishes
