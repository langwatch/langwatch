Feature: The unit-test-does-not-render lint rule
  A test that renders a component and mocks its boundaries is an integration test, not a
  unit test. A `.unit.test` file that imports from `@testing-library/*` is misnamed, not
  miswritten — the fix is a rename to the matching `.integration.test` filename, and the
  content stays exactly as it is.

  @unit
  Scenario: A unit test importing testing-library is reported once
    Given a .unit.test.tsx file that imports from two different @testing-library/* packages
    When the unit-test-does-not-render rule runs over it
    Then it reports unitTestImportsRenderer exactly once
    And the fix names the exact .integration.test.tsx filename to rename it to

  @unit
  Scenario: A type-only testing-library import is left alone
    Given a .unit.test.tsx file that imports a type only from @testing-library/react
    When the unit-test-does-not-render rule runs over it
    Then it reports nothing

  @unit
  Scenario: An integration test importing testing-library is left alone
    Given a .integration.test.tsx file that imports from @testing-library/react
    When the unit-test-does-not-render rule runs over it
    Then it reports nothing
