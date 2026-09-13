@unit
Feature: Exclusive bounds are written the way OpenAPI 3.1 reads them
  As an integrator generating a client from the API document
  I want a bound like "greater than zero" to survive into my client
  So that the generated types keep the constraint the route enforces

  # The document declares openapi 3.1.0, where a schema is JSON Schema 2020-12
  # and exclusiveMinimum / exclusiveMaximum are numbers. The schema builders
  # still emit the 3.0 spelling: a boolean flag beside a minimum or maximum.
  # A strict validator rejects it and a client generator drops the bound, so a
  # positive integer reached integrators as an unbounded one.

  Scenario: A boolean exclusive bound is rewritten as the number it meant
    Given a schema with "minimum" 0 and "exclusiveMinimum" true
    When the document is written
    Then the schema reads "exclusiveMinimum" 0
    And it carries no "minimum"

  Scenario: The same holds for an upper bound
    Given a schema with "maximum" 100 and "exclusiveMaximum" true
    When the document is written
    Then the schema reads "exclusiveMaximum" 100
    And it carries no "maximum"

  Scenario: An inclusive bound is left as it was
    Given a schema with "minimum" 0 and "exclusiveMinimum" false
    When the document is written
    Then the schema reads "minimum" 0
    And it carries no "exclusiveMinimum"

  Scenario: A flag with no bound beside it is dropped
    Given a schema with "exclusiveMinimum" true and no "minimum"
    When the document is written
    Then the schema carries no "exclusiveMinimum"

  Scenario: The published document carries no boolean exclusive bound
    When I read the generated OpenAPI document
    Then no schema in it spells an exclusive bound as a boolean
