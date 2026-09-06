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

  # ============================================================================
  # The Lite Member seat ceiling
  # ============================================================================

  # A Lite Member seat means viewing only, and the stored access says so too.
  # What the seat reaches is enforced when access is written, not just when
  # permissions are resolved, so an admin never sees an Admin row on a member
  # the seat caps at Viewer. Access granted through a group belongs to the
  # group, so it cannot be rewritten per member; those rows stay and say how
  # the seat applies them. Custom roles carry their own permissions, so holding
  # one requires a full seat.
  # The Add Members form scenarios for the same rules live in
  # member-role-team-restrictions.feature; these cover the member dialog and
  # the access batch behind it.

  Scenario: The access batch refuses an access row above Viewer for a member on a Lite Member seat
    Given the member is on a Lite Member seat
    When a save asks to add a team or project access row above Viewer
    Then the save is refused naming the seat rule
    And the member holds no access above Viewer

  Scenario: The access batch refuses a custom role for a member on a Lite Member seat
    Given the member is on a Lite Member seat
    When a save asks to add a custom role access row
    Then the save is refused naming the seat rule

  Scenario: The access batch refuses an organization access row for a member on a Lite Member seat
    Given the member is on a Lite Member seat
    When a save asks to add an organization access row
    Then the save is refused naming the seat rule

  Scenario: The access batch accepts a Viewer row for a member on a Lite Member seat
    Given the member is on a Lite Member seat
    When a save asks to add a Viewer team access row
    Then the save succeeds

  Scenario: The dialog offers only the Viewer role for a member on a Lite Member seat
    Given the member is on a Lite Member seat
    When the admin opens the role picker on the access row being added
    Then Viewer is the only role offered

  Scenario: Custom roles are not offered for a member on a Lite Member seat
    Given the organization has custom roles defined
    And the member is on a Lite Member seat
    When the admin opens the role picker on the access row being added
    Then no custom role is offered

  Scenario: Staged access rows correct to Viewer when the seat switches to Lite Member
    Given the admin staged an access row above Viewer
    When the admin picks a Lite Member seat
    Then the staged row becomes a Viewer row
    And the saved batch carries only Viewer rows

  Scenario: Group access names the Lite Member ceiling on rows above Viewer
    Given the member is on a Lite Member seat
    And a group grants them access above Viewer
    When the admin opens the member's details
    Then the group's role is shown as the group grants it
    And the row says it applies as Viewer while on a Lite Member seat

  Scenario: The group access editor keeps every role available
    Given an admin is editing a group's access rather than a member's
    When they open the role picker
    Then every role is offered, because a group has no seat

  Scenario: An invitation cannot carry team access above the invited seat
    Given an invitation for a Lite Member seat
    When it is created carrying a team role above Viewer
    Then it is refused naming the seat rule
    And accepting an invitation stored before this rule corrects its team access to Viewer
