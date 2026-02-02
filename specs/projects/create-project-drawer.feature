@integration
Feature: Create Project Drawer
  As a user managing projects
  I want to create new projects via a drawer interface
  So that I can add projects without leaving my current page

  Background:
    Given I am logged in as an authenticated user
    And I have permission to create projects
    And I am on a page with an "Add new project" button

  Scenario: Open drawer from settings projects page
    Given I am on the settings/projects page
    When I click the "Add new project" button
    Then the CreateProjectDrawer opens
    And I remain on the settings/projects page

  Scenario: Open drawer from project selector dropdown
    Given I am viewing the project selector dropdown in the navbar
    When I click "New Project"
    Then the CreateProjectDrawer opens
    And the dropdown closes

  @e2e
  Scenario: Create project in different organization from dropdown
    Given I am a member of organizations "Org A" and "Org B"
    And I am currently viewing a project in "Org A"
    When I open the project selector dropdown
    And I click "New Project" under "Org B"
    And I fill in the project details
    And I submit the form
    Then the project is created in "Org B"
    And I am navigated to the new project in "Org B"

  @integration
  Scenario: Drawer receives correct organization when opened from different org
    Given I am a member of organizations "Org A" and "Org B"
    And I am currently viewing a project in "Org A"
    When I click "New Project" under "Org B" in the dropdown
    Then the CreateProjectDrawer opens with organizationId for "Org B"
    And the form submission uses "Org B" organizationId

  Scenario: Open drawer from team settings page
    Given I am on the team settings page
    When I click the "Add new project" button
    Then the CreateProjectDrawer opens

  @visual
  Scenario: Drawer displays with correct structure
    When the CreateProjectDrawer opens
    Then I see a drawer sliding in from the right
    And I see a close button
    And I see a "Create New Project" title

  Scenario: Drawer displays all form fields
    When the CreateProjectDrawer opens
    Then I see a "Project Name" input field
    And I see a "Team" selector
    And I see a "Create" or "Save" button

  Scenario: Team selector shows available teams
    Given I belong to teams "Engineering" and "Data Science"
    When the CreateProjectDrawer opens
    Then the team selector shows "Engineering" and "Data Science"
    And there is an option to create a new team

  Scenario: Close drawer via close button
    Given the CreateProjectDrawer is open
    When I click the close button
    Then the drawer closes
    And no project is created

  Scenario: Close drawer via overlay click
    Given the CreateProjectDrawer is open
    When I click outside the drawer (on the overlay)
    Then the drawer closes

  Scenario: Close drawer via Escape key
    Given the CreateProjectDrawer is open
    When I press the Escape key
    Then the drawer closes

  Scenario: Project name is required
    Given the CreateProjectDrawer is open
    And the project name field is empty
    When I try to submit the form
    Then validation prevents submission
    And the project name field shows an error state

  Scenario: Project name with only whitespace is invalid
    Given the CreateProjectDrawer is open
    When I enter "   " (only spaces) as the project name
    And I try to submit the form
    Then validation prevents submission

  Scenario: Team selection is required
    Given the CreateProjectDrawer is open
    And no team is selected
    When I try to submit the form
    Then validation prevents submission

  Scenario: Valid form enables submit button
    Given the CreateProjectDrawer is open
    When I enter a valid project name
    And I select a team
    Then the submit button is enabled

  Scenario: Show new team name field when creating new team
    Given the CreateProjectDrawer is open
    When I select "Create new team" from the team selector
    Then a "New Team Name" input field appears

  Scenario: New team name is required when creating team
    Given I have selected "Create new team"
    And the new team name field is empty
    When I try to submit the form
    Then validation prevents submission
    And the new team name field shows an error state

  Scenario: Show limit warning when at max projects
    Given my organization has reached the maximum project limit
    When the CreateProjectDrawer opens
    Then I see a warning about the project limit
    And I see a link to upgrade my plan

  Scenario: Disable creation when at max projects
    Given my organization has reached the maximum project limit
    And the plan does not override adding limitations
    When I try to submit the form
    Then creation is blocked
    And I see a message to upgrade

  @unit
  Scenario: Allow creation when plan has override enabled
    Given my organization has reached the maximum project limit
    But the plan has overrideAddingLimitations enabled
    When the CreateProjectDrawer opens
    Then the Create button is enabled
    And I can submit the form successfully

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
