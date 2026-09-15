Feature: The type-only-value-import lint rule
  Importing an interface or type alias as a value is a syntax error at
  runtime under ESM: the target module never emits that export, so Node
  throws `SyntaxError: does not provide an export named`. The fix is always
  `import type` instead of `import`.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A value import of an interface is a runtime link failure
    Given a relative import of a name that is only declared as an interface
    When the type-only-value-import rule runs over it
    Then it reports valueImportOfType
    And the message names the imported symbol and the file it is declared in

  @unit
  Scenario: An import type of an interface is allowed
    Given the same import written as import type
    When the type-only-value-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: A value import of a class is allowed
    Given a relative import of a name that is declared as a class
    When the type-only-value-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: An unresolvable import specifier is not governed
    Given a relative import whose target file does not exist
    When the type-only-value-import rule runs over it
    Then it reports nothing
