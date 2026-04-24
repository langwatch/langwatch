@integration
Feature: Project Creation Flow
  As a user
  I want to create a new project successfully
  So that I can start tracking my LLM application

  Background:
    Given I am logged in as an authenticated user
    And I have permission to create projects
    And I am within my organization's project limit

  @unimplemented
  Scenario: Create project with all required fields
    Given the CreateProjectDrawer is open
    When I enter "My New Chatbot" as the project name
    And I select team "Engineering"
    And I click the "Create" button
    Then the project is created successfully
    And I see a success toast notification
    And the drawer closes

  @unimplemented
  Scenario: Create project with new team
    Given the CreateProjectDrawer is open
    When I enter "Analytics Bot" as the project name
    And I select "Create new team"
    And I enter "Analytics Team" as the new team name
    And I click the "Create" button
    Then a new team "Analytics Team" is created
    And the project is created under "Analytics Team"
    And I see a success toast notification

  @unimplemented
  Scenario: Project creation calls correct API endpoint
    Given the CreateProjectDrawer is open with valid data
    When I submit the form
    Then the api.project.create mutation is called
    And the mutation payload includes:
      | field          | value             |
      | name           | the project name  |
      | teamId         | the selected team |
      | language       | "other"           |
      | framework      | "other"           |
      | organizationId | current org id    |

  @unimplemented
  Scenario: Handle API error gracefully
    Given the CreateProjectDrawer is open with valid data
    And the API will return an error
    When I submit the form
    Then I see an error toast notification
    And the drawer remains open
    And I can retry the submission

  @unimplemented
  Scenario: Handle duplicate project name error
    Given a project named "Existing Project" already exists
    And the CreateProjectDrawer is open
    When I enter "Existing Project" as the name
    And I submit the form
    Then I see an error message about duplicate name
    And the drawer remains open

  @unimplemented
  Scenario: Drawer closes after successful creation
    Given I have successfully created a project
    Then the CreateProjectDrawer is closed
    And the URL no longer has drawer.open parameter

  @unimplemented
  Scenario: Success toast shows project name
    Given I create a project named "My Bot"
    When creation succeeds
    Then the success toast includes "My Bot"

  @unimplemented
  Scenario: Optional redirect to new project
    Given a redirect is configured after creation
    When I successfully create project "New Bot"
    Then I am redirected to the new project's dashboard

  @unimplemented
  Scenario: Stay on current page when no redirect configured
    Given I am on the settings/projects page
    And no redirect is configured
    When I successfully create a project
    Then I remain on the settings/projects page
    And the new project appears in the list

  @unimplemented
  Scenario: Form resets after successful creation
    Given I successfully created a project
    When I open the CreateProjectDrawer again
    Then the form fields are empty/default
    And there is no residual data from previous creation

  @unimplemented
  Scenario: Form resets when drawer is closed without saving
    Given I have partially filled the form
    When I close the drawer without submitting
    And I open the drawer again
    Then the form fields are empty/default

  @unimplemented
  Scenario: Track project creation event
    When I successfully create a project
    Then a tracking event is sent with project creation details
