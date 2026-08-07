@integration
Feature: Editing a member's access
  An organization admin edits one member's seat and access rows in a single
  dialog and saves once. The saved batch describes the state the admin wants
  the member's access to be in, so re-asserting something that is already true
  is a success, not an error. A customer reducing seats reported the opposite:
  re-adding an existing row failed with an unknown error, removing a row while
  picking a Lite Member seat failed with "one or more bindings not found", and
  every failure left the dialog showing access rows the save had in fact
  already changed.

  Background:
    Given an organization admin editing a member of their organization

  Scenario: Re-adding an access row the member already holds saves cleanly
    When the admin adds a team access row identical to one the member already holds
    And saves
    Then the save succeeds
    And the member holds that access exactly once

  Scenario: Removing an access row that is already gone saves cleanly
    Given the staged removal points at an access row a concurrent change already deleted
    When the admin saves
    Then the save succeeds

  Scenario: Moving to a Lite Member seat while removing an access row saves cleanly
    When the admin picks a Lite Member seat and removes one of the member's team access rows
    And saves
    Then the save succeeds
    And the member is on a Lite Member seat
    And the member no longer holds the removed team access

  Scenario: A member's save cannot remove another principal's access
    Given the staged removals name an access row belonging to another member and one belonging to a group
    When the admin saves
    Then the other member's access row survives
    And the group's access row survives

  Scenario: Group access is listed on every plan
    Given the organization is not on an Enterprise plan
    And the member belongs to a group that grants access
    When the admin opens the member's details
    Then the member's groups are listed rather than refused

  Scenario: A failed save shows the member's access as it now is
    Given the seat change landed but the access change then failed
    When the admin sees the failure
    Then the dialog shows the member's access as the server has it
    And not the rows the save already changed

  Scenario: An access row the member already holds appears once
    When the admin adds an access row identical to one already listed
    Then the dialog lists that access exactly once

  Scenario: A picked access row saves without pressing Add
    When the admin fills in a complete access row and saves without adding it
    Then the save includes that access

  Scenario: The seat's own organization access is changed through the seat selector
    Given the member holds the organization access their seat grants
    When the admin looks for a way to remove that access
    Then there is none
    And other organization access stays removable
