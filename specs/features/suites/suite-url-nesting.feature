Feature: Suite URL path nested under simulations
  As a LangWatch user
  I want suite pages to be under /simulations/suites in the URL
  So that the URL structure matches the navigation menu hierarchy

  Background:
    Given a project with slug "my-project"

  # Navigation and routing
  @integration
  Scenario: Suite route path is nested under simulations
    Given I am logged in as a user in the "my-project" project
    When I navigate to Suites
    Then the URL contains "/my-project/simulations/suites"

  @integration
  Scenario: Navigation link points to the new suite URL
    Given I am viewing the project sidebar
    When I look at the Suites link under Simulations
    Then the link href includes "/simulations/suites"

  @integration
  Scenario: Only Suites is active in sidebar when viewing suites page
    Given I am on the suites page at "/my-project/simulations/suites"
    When I look at the sidebar
    Then the Suites menu item is active
    And the Runs menu item is not active

  # Happy path - full system flow
  @e2e
  Scenario: User navigates to suites via simulations menu
    Given I am logged in
    When I open the Simulations section in the sidebar
    And I click the Suites link
    Then I see the suites page
    And the URL contains "/simulations/suites"
