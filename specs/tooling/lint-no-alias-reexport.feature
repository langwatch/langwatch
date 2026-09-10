Feature: The no-alias-reexport lint rule
  A barrel that re-exports a symbol under a second name is a compatibility
  shim: two names now resolve to the same thing, and a reader or a rename
  tool cannot tell which one is the real one. Rename the symbol itself
  instead of adding an alias on the way out.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A re-export alias hides which name is real
    Given a barrel file that re-exports a symbol from another module under a new name
    When the no-alias-reexport rule runs over it
    Then it reports aliasReexport
    And the message names the local symbol and the exported alias

  @unit
  Scenario: A local export alias hides which name is real
    Given a barrel file that re-exports a local symbol under a new name
    When the no-alias-reexport rule runs over it
    Then it reports aliasReexport

  @unit
  Scenario: An export under its own name is allowed
    Given a barrel file that re-exports a symbol under its own name
    When the no-alias-reexport rule runs over it
    Then it reports nothing

  @unit
  Scenario: An alias export outside a barrel is not governed
    Given a non-barrel file with the same alias export
    When the no-alias-reexport rule runs over it
    Then it reports nothing
