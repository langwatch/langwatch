Feature: Lent components, hooks and drawers
  A module lends what it owns; a reader borrows it by token.

  @integration
  Scenario: A lent component renders for its reader
    When a reader renders a lent component
    Then it renders with the reader's props

  @integration
  Scenario: An unlent component reads as nothing
    When a reader asks for a token nobody lent
    Then it answers nothing

  @integration
  Scenario: An extension token reads as a list in install order
    When several modules lend one extension token
    Then the reader gets every lender in install order

  @integration
  Scenario: Lent hooks arrive as the eager object the owner lent
    When a reader borrows lent hooks
    Then it gets the owner's value as lent

  @unit
  Scenario: An owner's lends and drawers install
    When a module installs the lends and drawers it owns, extension tokens included
    Then nothing is raised

  @unit
  Scenario: A foreign owner's token is refused at install
    When a module lends a token another module owns
    Then install refuses, naming the module and the owner

  @unit
  Scenario: Two lenders of one token are refused, naming both
    When two modules lend the same token
    Then install refuses, naming both lenders

  @unit
  Scenario: A token lend is also declared under the legacy name
    When a module lends a token
    Then the payload is declared under the token's name too

  @unit
  Scenario: A drawer token registers under its wire name
    When a module installs a drawer token
    Then its loader is registered under the wire name
