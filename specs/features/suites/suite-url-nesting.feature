Feature: Suite URL path nested under simulations
  As a LangWatch user
  I want suite pages to be under /simulations/suites in the URL
  So that the URL structure matches the navigation menu hierarchy

  # Parity status: 0 of 4 scenarios bound to existing tests.
  # Remaining @unimplemented scenarios (#3458):
  #   4 UPDATE: implementation diverged from spec wording
  # UPDATE divergences:
  #   - "Suite route path is nested under simulations": URL is now /simulations/run-plans/:slug, not /simulations/suites
  #   - "Navigation link points to the new suite URL": Sidebar link points to /simulations after #2320 rename to Run Plans
  #   - "Only Suites is active in sidebar when viewing suites page": Menu item renamed to "Run Plans"/"Run History" per #2320; "Suites menu item" wording stale
  #   - "User navigates to suites via simulations menu": Path/label diverged after #2320 + #2946; SuiteUrlRouting.integration.test.tsx covers current behavior

  Background:
    Given a project with slug "my-project"

  # Navigation and routing
  @integration @unimplemented
  Scenario: Suite route path is nested under simulations
    Given I am logged in as a user in the "my-project" project
    When I navigate to Suites
    Then the URL contains "/my-project/simulations/suites"

  @integration @unimplemented
  Scenario: Navigation link points to the new suite URL
    Given I am viewing the project sidebar
    When I look at the Suites link under Simulations
    Then the link href includes "/simulations/suites"

  @integration @unimplemented
  Scenario: Only Suites is active in sidebar when viewing suites page
    Given I am on the suites page at "/my-project/simulations/suites"
    When I look at the sidebar
    Then the Suites menu item is active
    And the Runs menu item is not active

  # Happy path - full system flow
  @e2e @unimplemented
  Scenario: User navigates to suites via simulations menu
    Given I am logged in
    When I open the Simulations section in the sidebar
    And I click the Suites link
    Then I see the suites page
    And the URL contains "/simulations/suites"
