Feature: The no-prototype-stub lint rule
  A test that builds its double with `Object.create(X.prototype)` gets an
  object that answers `instanceof` but has none of its fields set, which
  hides the class's real shape from the reader and from the test itself.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A prototype stub hides the class shape
    Given a test file that builds a stub with Object.create of a class prototype
    When the no-prototype-stub rule runs over it
    Then it reports prototypeStub
    And the message names the class the stub was built from

  @unit
  Scenario: Object.create without a class prototype is allowed
    Given a test file that calls Object.create with a plain object literal
    When the no-prototype-stub rule runs over it
    Then it reports nothing

  @unit
  Scenario: A prototype stub outside a test file is not governed
    Given a non-test file with the same Object.create call
    When the no-prototype-stub rule runs over it
    Then it reports nothing
