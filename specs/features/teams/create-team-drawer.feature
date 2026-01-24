@integration
Feature: Create Team Drawer
  As a user managing teams
  I want to create new teams via a drawer interface
  So that I can add teams without leaving my current page

  Background:
    Given I am logged in as an authenticated user
    And I have permission to manage teams
    And I am on the settings/teams page

  Scenario: Open drawer from teams settings page
    When I click the "Add new team" button
    Then the CreateTeamDrawer opens
    And I remain on the settings/teams page

  @visual
  Scenario: Drawer displays with correct structure
    When the CreateTeamDrawer opens
    Then I see a drawer sliding in from the right
    And I see a close button
    And I see a "Create New Team" title

  Scenario: Drawer displays all form fields
    When the CreateTeamDrawer opens
    Then I see a "Name" input field with helper text "The name of your team"
    And I see a "Members" section with a table
    And I see a "Create" button

  Scenario: Members table shows correct columns
    When the CreateTeamDrawer opens
    Then I see a members table with columns "NAME" and "TEAM ROLE"
    And I see an "Add Another" button below the table

  Scenario: Current user is pre-populated as first member
    When the CreateTeamDrawer opens
    Then I see myself listed as the first member
    And my role is set to "Admin"

  Scenario: Add another member to the team
    Given the CreateTeamDrawer is open
    When I click the "Add Another" button
    Then a new member row is added to the table
    And I can select a user from the organization

  Scenario: Remove a member from the team
    Given the CreateTeamDrawer is open
    And I have added multiple members
    When I click the remove button on a member row
    Then that member is removed from the list

  Scenario: Cannot remove the last member
    Given the CreateTeamDrawer is open
    And there is only one member in the list
    Then the remove button is disabled or hidden

  Scenario: Member selector shows organization users
    Given my organization has users "Alice", "Bob", and "Charlie"
    When I click the member selector dropdown
    Then I see "Alice", "Bob", and "Charlie" as options

  Scenario: Role selector shows available team roles
    When I click the role selector for a member
    Then I see "Admin" and "Member" as role options

  Scenario: Close drawer via close button
    Given the CreateTeamDrawer is open
    When I click the close button
    Then the drawer closes
    And no team is created

  Scenario: Close drawer via overlay click
    Given the CreateTeamDrawer is open
    When I click outside the drawer (on the overlay)
    Then the drawer closes

  Scenario: Close drawer via Escape key
    Given the CreateTeamDrawer is open
    When I press the Escape key
    Then the drawer closes

  Scenario: Team name is required
    Given the CreateTeamDrawer is open
    And the team name field is empty
    When I try to submit the form
    Then validation prevents submission
    And the team name field shows an error state

  Scenario: Team name with only whitespace is invalid
    Given the CreateTeamDrawer is open
    When I enter "   " (only spaces) as the team name
    And I try to submit the form
    Then validation prevents submission

  Scenario: At least one member is required
    Given the CreateTeamDrawer is open
    And I have removed all members from the list
    When I try to submit the form
    Then validation prevents submission
    And I see an error about requiring at least one member

  Scenario: Valid form enables submit button
    Given the CreateTeamDrawer is open
    When I enter a valid team name
    And I have at least one member selected
    Then the submit button is enabled

  @visual
  Scenario: Show loading state during submission
    Given I have filled out the form correctly
    When I click the submit button
    Then the submit button shows a loading indicator
    And the form fields are disabled during submission

  Scenario: Disable submit button while loading
    Given the form is being submitted
    Then the submit button is disabled
    And I cannot click it again

  Scenario: Successful team creation closes drawer
    Given I have filled out the form with valid data
    When I submit the form
    And the team is created successfully
    Then the drawer closes
    And I see a success notification

  Scenario: Team list refreshes after creation
    Given I have filled out the form with valid data
    When I submit the form successfully
    Then the teams table is refreshed
    And I see the newly created team in the list

  Scenario: Error during creation shows error message
    Given I have filled out the form with valid data
    And the server returns an error
    When I submit the form
    Then I see an error notification
    And the drawer remains open
    And I can correct the issue and retry

  Scenario: Duplicate team name shows validation error
    Given a team named "Engineering" already exists
    When I enter "Engineering" as the team name
    And I try to submit the form
    Then I see an error about duplicate team name
