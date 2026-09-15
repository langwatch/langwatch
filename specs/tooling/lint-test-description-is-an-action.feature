Feature: The test-description-is-an-action lint rule

  A test title states what the test does ("checks local first"), not a
  prediction about what it should do ("should check local first"). A nested
  `describe` reads as BDD structure: the outer block sets up the given
  precondition, the inner block names the when-action, so a nested block with
  neither prefix has lost that structure. TESTING_PHILOSOPHY.md also blesses
  one further level of nesting before the given/when pair starts, naming the
  unit under test MDN-style (`ClassName`, `methodName()`, `<Component/>`,
  `useHook()`) — that shape is exempt, not a violation.

  @unit
  Scenario: A should-prefixed it title is a failure
    Given a test file whose it title starts with "should"
    When the test-description-is-an-action rule runs over it
    Then it reports titleStartsWithShould

  @unit
  Scenario: A Should-prefixed test title is a failure regardless of case
    Given a test file whose test title starts with "Should"
    When the test-description-is-an-action rule runs over it
    Then it reports titleStartsWithShould

  @unit
  Scenario: An action-phrased it title is allowed
    Given a test file whose it title states the action it verifies
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A nested describe titled given or when is allowed
    Given a describe nested inside another describe with a "given " title
    And a describe nested inside that one with a "when " title
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A nested describe missing given or when is a failure
    Given a describe nested inside another describe with a plain phrase title
    When the test-description-is-an-action rule runs over it
    Then it reports nestedDescribeMissingGivenWhen

  @unit
  Scenario: A top-level describe is exempt from given/when
    Given a top-level describe naming the unit under test
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: An and-prefixed nested describe is left alone
    Given a describe nested inside a "given " describe with an "and " title
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A nested describe naming the unit under test is left alone
    Given a describe nested inside another describe titled with a method name
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A nested describe naming a component under test is left alone
    Given a describe nested inside another describe titled with a component or hook name
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A capitalized phrase is still a failure, not a unit name
    Given a describe nested inside another describe titled with a capitalized phrase
    When the test-description-is-an-action rule runs over it
    Then it reports nestedDescribeMissingGivenWhen

  @unit
  Scenario: A should-prefixed title outside a test file is not governed
    Given a should-prefixed it title in a file that is not a test file
    When the test-description-is-an-action rule runs over it
    Then it reports nothing
