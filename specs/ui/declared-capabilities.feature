# Implementation:
#   packages/browser-host/src/declarations.ts
#   apps/ui/src/shell/ui-declarations.ts

Feature: A module reads what its peers declared, by name
  A capability a module declares through `withCapabilities` reaches a peer's
  own host through the shell (ARCHITECTURE.md 10.1): organization's
  Authentication overview draws the cards sso and scim declare, and
  onboarding's create screen draws the join offer organization declares.
  Neither side imports the other's browser package.

  @unit
  Scenario: Declarations are read in install order
    Given two installed modules that both declare an overview card
    When a host reads the overview cards
    Then it receives both, in the order the modules were installed, each naming its module

  @unit
  Scenario: A module that declared nothing under the name is skipped
    Given an installed module whose declaration names other capabilities only
    When a host reads the overview cards
    Then that module contributes nothing

  @unit
  Scenario: A screen mounted with no shell reads nothing declared
    Given no declarations were installed
    When a host reads the join offer
    Then it receives an empty list rather than a refusal
