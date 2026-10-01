Feature: Efficient Zod object composition
  As a contributor defining validation boundaries
  I want derived object schemas to avoid unnecessary mapped generic composition
  So that shared contracts cost less to typecheck

  Background:
    Given Zod schemas remain the source of truth for parsed input and output

  Scenario: A derived object spreads its fields
    Given a production schema is a statically resolved Zod object
    When it is composed with extend or merge
    Then lint reports zod-object-composition
    And the diagnostic recommends composing its shape with an object constructor
    And the diagnostic requires preserving strictness and catchall behavior

  Scenario: Schema aliases and imports retain their identity
    Given a Zod object is aliased locally or imported from workspace source
    When its extend or merge method is called
    Then lint follows named imports and re-exports to the object definition
    And an unrelated shadowing binding is not treated as that schema

  Scenario: Refinements survive object composition
    Given a Zod object has refinements
    When its shape needs additional fields
    Then safeExtend is allowed
    And lint does not automatically replace the schema with a shape spread

  Scenario: Unrelated APIs are not mistaken for schemas
    Given a receiver cannot be statically resolved to a Zod object
    When it calls a method named extend or merge
    Then this rule reports nothing
    And opaque factories do not trigger a separate typechecking pass

  Scenario: Generated artifacts and test fixtures are excluded
    Given a source file is generated, a declaration, or a test
    When lint evaluates object composition
    Then this rule reports nothing
