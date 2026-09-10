Feature: The banned-legacy-names lint rule
  These names belonged to the transport shape the runtime replaced with
  `defineRestRouter` and `runtime.mount`. A reintroduction under the old
  name is a sign the wrong exemplar got copied, not a deliberate choice.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Importing a deleted transport helper is banned
    Given any source file that imports a banned legacy name
    When the banned-legacy-names rule runs over it
    Then it reports bannedLegacyName
    And the message names the banned identifier

  @unit
  Scenario: Redeclaring a deleted transport helper is banned
    Given any source file that declares a function under a banned legacy name
    When the banned-legacy-names rule runs over it
    Then it reports bannedLegacyName

  @unit
  Scenario: Redeclaring a deleted transport class is banned
    Given any source file that declares a class under a banned legacy name
    When the banned-legacy-names rule runs over it
    Then it reports bannedLegacyName

  @unit
  Scenario: An unrelated import is allowed
    Given any source file that imports an unrelated name
    When the banned-legacy-names rule runs over it
    Then it reports nothing
