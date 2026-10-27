@unit
Feature: Active administrators of an organisation
  As a module that must not lock an organisation out of itself
  I need authz to name the administrators who can still sign in
  So that a removal guard asks authz instead of organization

  An active administrator is organization's own definition: a membership with
  organisation role ADMIN whose seat is not disabled
  (organization-membership.service.ts, assertRemovalKeepsAnAdministrator).
  Authz reads it from the membership rows it already decides access from.

  Scenario: A seat-disabled administrator is not counted
    Given an organisation with two administrators
    When one administrator's seat is disabled
    Then only the other administrator is named

  Scenario: A re-enabled administrator is counted again
    Given an administrator whose seat was disabled
    When the seat is enabled again
    Then that administrator is named

  Scenario: A member who is not an administrator is not counted
    Given an organisation with an administrator and a plain member
    When its active administrators are read
    Then only the administrator is named

  Scenario: An unknown organisation has no active administrators
    Given an organisation id that names no organisation
    When its active administrators are read
    Then the answer is an empty list and nothing is thrown

  Scenario: Another organisation's administrators are not counted
    Given an administrator of a different organisation
    When this organisation's active administrators are read
    Then that administrator is not named
