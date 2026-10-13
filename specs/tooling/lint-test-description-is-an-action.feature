Feature: The test-description-is-an-action lint rule

  A nested `describe` reads as BDD structure: the outer block sets up the given
  precondition, the inner block names the when-action, so a nested block with
  neither prefix has lost that structure. TESTING_PHILOSOPHY.md also blesses
  one further level of nesting before the given/when pair starts, naming the
  unit under test MDN-style (`ClassName`, `methodName()`, `<Component/>`,
  `useHook()`), and that shape is exempt. A test title that predicts ("should
  check local first") instead of stating the action is the native
  `vitest/valid-title` rule's, configured in `.oxlintrc.jsonc`.

  @unit
  Scenario: A should-prefixed title is left to vitest/valid-title
    Given a test file whose it title starts with "should"
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
    Then it reports nestedDescribeMissingGivenWhen on the title's line

  @unit
  Scenario: A nested describe.each title missing given or when is a failure
    Given a describe.each table nested inside another describe with a plain phrase title
    When the test-description-is-an-action rule runs over it
    Then it reports nestedDescribeMissingGivenWhen on the table title's line

  @unit
  Scenario: A nested describe.each titled when is allowed
    Given a describe.each table nested inside another describe with a "when " title
    When the test-description-is-an-action rule runs over it
    Then it reports nothing

  @unit
  Scenario: A describe inside a describe.each table is nested
    Given a describe with a plain phrase title inside a top-level describe.each table
    When the test-description-is-an-action rule runs over it
    Then it reports nestedDescribeMissingGivenWhen on the inner title's line

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
  Scenario: A nested describe outside a test file is not governed
    Given a nested describe with a plain phrase title in a file that is not a test file
    When the test-description-is-an-action rule runs over it
    Then it reports nothing
