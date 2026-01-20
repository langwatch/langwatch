@integration
Feature: Project List Refresh After Creation
  As a user
  I want newly created projects to appear immediately in all project lists
  So that I don't need to refresh the page to see my new project

  Background:
    Given I am logged in as an authenticated user
    And I have permission to create projects

  Scenario: New project appears in settings projects list immediately
    Given I am on the settings/projects page
    And I see my existing projects listed
    When I create a new project "Fresh Project" via the drawer
    Then "Fresh Project" appears in the projects list
    And I did not need to refresh the page

  Scenario: New project appears in navbar project selector immediately
    Given I am viewing the project selector dropdown
    And I see my existing projects
    When I create a new project "Quick Bot" via the drawer
    And I open the project selector dropdown again
    Then "Quick Bot" appears in the dropdown list

  Scenario: Project count updates after creation
    Given my organization has 3 projects
    When I create a new project
    Then the project count reflects 4 projects

  Scenario: Query invalidation triggers on successful creation
    Given the CreateProjectDrawer is open with valid data
    When I successfully submit the form
    Then organization.getAll query is invalidated
    And limits.getUsage query is invalidated

  Scenario: Project appears in correct team section
    Given I create a project under team "Engineering"
    When I view the settings/projects page
    Then the new project appears under the "Engineering" team section

  Scenario: New team appears with its project
    Given I create a project with a new team "New Team"
    When I view the settings/projects page
    Then "New Team" section appears in the list
    And the new project appears under "New Team"

  Scenario: Multiple rapid creations all appear
    Given I create project "Project A"
    And I create project "Project B"
    And I create project "Project C"
    When I view the projects list
    Then all three projects appear in the list

  Scenario: Project list stays consistent after drawer close
    Given I created a project and the drawer closed
    When I navigate away and come back to settings/projects
    Then the newly created project is still visible
