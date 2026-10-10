Feature: The team settings page reads as main's does
  One team's settings open inside the settings shell, with the settings sidebar,
  and the way to the organization's members is a link, as it is on main.

  @unit
  Scenario: The team settings page is declared inside the settings shell
    Given a browser that installs organization
    When the team settings screen is looked up
    Then it sits at "/settings/teams/:team" within "settings"

  @integration
  Scenario: The team settings page offers the organization's members as a link
    Given a team the reader may edit
    When the team settings page opens
    Then "Manage organization members" is a link to "/settings/members"

  @unit
  Scenario: A member with no display name is labelled by their email in team pickers
    Given an account with an email but no display name
    When it is offered as a team member
    Then its label is the email alone, never "null"

  @integration
  Scenario: A blank team name is refused on the field
    Given the Create New Team drawer
    When Create is pressed with the name left blank
    Then the name field says it is required, as on main
    And no team is sent to be created

  @integration
  Scenario: Renaming a team saves the new name
    Given a team the reader may edit, with one admin member
    When a new name is typed into the name field and Enter is pressed
    Then the team is saved with the new name and its members unchanged, with no save button

  @integration
  Scenario: An archived team's address says the team was not found
    Given a team that has been archived
    When its settings address is opened
    Then the page says the team was not found, with no loading skeleton

  @unit
  Scenario: A team name is unique within its organization
    Given an organization with a live team called "Platform"
    When a team is created, or another team is renamed, to " platform "
    Then it is refused with status 409 and the code "team_name_taken"
    And the message reads "A team called platform already exists"

  @unit
  Scenario: A team keeps its own name when it is saved again
    Given an organization with a live team called "Platform"
    When that team is renamed to "PLATFORM"
    Then the rename is accepted

  @integration
  Scenario: The create-team drawer shows a taken name under the name field
    Given the server refuses a new team with "team_name_taken"
    When Create is pressed
    Then the name field shows "A team called Platform already exists"

  @integration
  Scenario: The team settings page shows a taken name under the name field
    Given the server refuses a rename with "team_name_taken"
    When the new name is saved
    Then the name field shows "A team called Taken already exists"
