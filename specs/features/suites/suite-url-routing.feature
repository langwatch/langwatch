Feature: URL routing for direct suite access
  As a LangWatch user
  I want each suite to have its own URL
  So that I can bookmark, share, and navigate directly to specific suites

  # Parity status: 0 of 9 scenarios bound to existing tests.
  # Remaining @unimplemented scenarios (#3458):
  #   3 NO_TEST: shipped behavior, no integration test yet
  #   5 UPDATE: implementation diverged from spec wording
  # UPDATE divergences:
  #   - "Selecting a suite updates the URL to include the suite slug" (path-based, not query-param)
  #   - "Selecting \"All Runs\" removes the suite query param" (path segment removal, not query param)
  #   - "Navigating directly to a suite URL opens that suite" (/run-plans/:slug not ?suite=)
  #   - "Navigating to base suites URL shows all runs view" (base is /simulations not /simulations/suites)
  #   - "Navigating to a non-existent suite slug shows empty state" (URL pattern diverged)
  #   - "User shares a direct link to a suite" (URL format diverged)
  # NO_TEST gaps:
  #   - "Archiving the current suite navigates to base path"
  #   - "Browser back button returns to previous suite"
  #   - "Browser forward button navigates to next suite"

  Background:
    Given a project with slug "my-project"
    And the project has suites "Suite A" (slug "suite-a") and "Suite B" (slug "suite-b")

  # Routing: suite selection reflected in URL
  @integration @unimplemented
  Scenario: Selecting a suite updates the URL to include the suite slug
    Given I am on the suites page at "/my-project/simulations/suites"
    When I click on "Suite A" in the sidebar
    Then the URL changes to "/my-project/simulations/suites?suite=suite-a"

  @integration @unimplemented
  Scenario: Selecting "All Runs" removes the suite query param
    Given I am viewing "Suite A" at "/my-project/simulations/suites?suite=suite-a"
    When I click "All Runs" in the sidebar
    Then the URL changes to "/my-project/simulations/suites"

  # Direct navigation via URL
  @integration @unimplemented
  Scenario: Navigating directly to a suite URL opens that suite
    When I navigate to "/my-project/simulations/suites?suite=suite-a"
    Then "Suite A" is selected in the sidebar
    And the main content shows "Suite A" details

  @integration @unimplemented
  Scenario: Navigating to base suites URL shows all runs view
    When I navigate to "/my-project/simulations/suites"
    Then "All Runs" is selected in the sidebar
    And the main content shows the all runs view

  @integration @unimplemented
  Scenario: Navigating to a non-existent suite slug shows empty state
    When I navigate to "/my-project/simulations/suites?suite=non-existent-slug"
    Then the main content shows an empty state
    And the sidebar does not highlight any suite

  # Post-mutation navigation
  @integration @unimplemented
  Scenario: Archiving the current suite navigates to base path
    Given I am viewing "Suite A" at "/my-project/simulations/suites?suite=suite-a"
    When I archive "Suite A"
    Then the URL changes to "/my-project/simulations/suites"

  # Browser history
  @e2e @unimplemented
  Scenario: Browser back button returns to previous suite
    Given I am logged in
    And I am viewing "Suite A"
    When I click on "Suite B" in the sidebar
    And I press the browser back button
    Then the URL contains "suite=suite-a"
    And "Suite A" is selected in the sidebar

  @e2e @unimplemented
  Scenario: Browser forward button navigates to next suite
    Given I am logged in
    And I navigated from "Suite A" to "Suite B" and pressed back
    When I press the browser forward button
    Then the URL contains "suite=suite-b"
    And "Suite B" is selected in the sidebar

  # Happy path - full system flow
  @e2e @unimplemented
  Scenario: User shares a direct link to a suite
    Given I am logged in
    And I have created a suite named "Shared Suite"
    When I select "Shared Suite" from the sidebar
    And I copy the URL from the browser
    And I open that URL in a new session
    Then I see "Shared Suite" selected and its details displayed
