Feature: URL routing for direct suite access
  As a LangWatch user
  I want each suite to have its own URL
  So that I can bookmark, share, and navigate directly to specific suites

  Background:
    Given a project with slug "my-project"
    And the project has suites "Suite A" (slug "suite-a") and "Suite B" (slug "suite-b")

  # Routing: suite selection reflected in URL
  @integration
  Scenario: Selecting a suite updates the URL to include the suite slug
    Given I am on the suites page at "/my-project/simulations/suites"
    When I click on "Suite A" in the sidebar
    Then the URL changes to "/my-project/simulations/suites?suite=suite-a"

  @integration
  Scenario: Selecting "All Runs" removes the suite query param
    Given I am viewing "Suite A" at "/my-project/simulations/suites?suite=suite-a"
    When I click "All Runs" in the sidebar
    Then the URL changes to "/my-project/simulations/suites"

  # Direct navigation via URL
  @integration
  Scenario: Navigating directly to a suite URL opens that suite
    When I navigate to "/my-project/simulations/suites?suite=suite-a"
    Then "Suite A" is selected in the sidebar
    And the main content shows "Suite A" details

  @integration
  Scenario: Navigating to base suites URL shows all runs view
    When I navigate to "/my-project/simulations/suites"
    Then "All Runs" is selected in the sidebar
    And the main content shows the all runs view

  @integration
  Scenario: Navigating to a non-existent suite slug shows empty state
    When I navigate to "/my-project/simulations/suites?suite=non-existent-slug"
    Then the main content shows an empty state
    And the sidebar does not highlight any suite

  # Post-mutation navigation
  @integration
  Scenario: Archiving the current suite navigates to base path
    Given I am viewing "Suite A" at "/my-project/simulations/suites?suite=suite-a"
    When I archive "Suite A"
    Then the URL changes to "/my-project/simulations/suites"

  # Browser history
  @e2e
  Scenario: Browser back button returns to previous suite
    Given I am logged in
    And I am viewing "Suite A"
    When I click on "Suite B" in the sidebar
    And I press the browser back button
    Then the URL contains "suite=suite-a"
    And "Suite A" is selected in the sidebar

  @e2e
  Scenario: Browser forward button navigates to next suite
    Given I am logged in
    And I navigated from "Suite A" to "Suite B" and pressed back
    When I press the browser forward button
    Then the URL contains "suite=suite-b"
    And "Suite B" is selected in the sidebar

  # Happy path - full system flow
  @e2e
  Scenario: User shares a direct link to a suite
    Given I am logged in
    And I have created a suite named "Shared Suite"
    When I select "Shared Suite" from the sidebar
    And I copy the URL from the browser
    And I open that URL in a new session
    Then I see "Shared Suite" selected and its details displayed
