Feature: Runs Page — Unified Navigation & URL Routing
  As a LangWatch user
  I want a single unified page for all simulation runs (SDK-driven and platform-created)
  So that I can access run history through clean URLs, navigate directly to specific batch runs,
  and manage both external sets and run plans from one place

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Menu & Naming
  # ============================================================================

  @integration
  Scenario: Sidebar shows "Runs" menu item without beta badge
    When I view the main navigation
    Then I see a "Runs" link under Simulations with a play-circle icon
    And the link does not have a beta badge

  @integration
  Scenario: No separate "Run History" or "Run Plans" menu items exist
    When I view the main navigation
    Then I do not see a "Run History" link
    And I do not see a "Run Plans" link with a beta badge

  @integration
  Scenario: Page heading reads "Simulations"
    When I navigate to "/my-project/simulations"
    Then the page heading is "Simulations"

  @integration
  Scenario: New Run Plan button text is unchanged
    When I navigate to "/my-project/simulations"
    Then I see a "+ New Run Plan" button

  # ============================================================================
  # URL Routing — Base
  # ============================================================================

  @integration
  Scenario: Navigating to /simulations shows All Runs view
    When I navigate to "/my-project/simulations"
    Then I see the "All Runs" view with the sidebar and run history panel

  @integration
  Scenario: Navigating to /simulations/run-plans/:suiteSlug shows suite detail
    Given suite "critical-path" exists in the project
    When I navigate to "/my-project/simulations/run-plans/critical-path"
    Then the sidebar highlights "critical-path"
    And the main panel shows the suite detail for "critical-path"

  @integration
  Scenario: Navigating to /simulations/:externalSetSlug shows external set
    Given external set "python-examples" exists in the project
    When I navigate to "/my-project/simulations/python-examples"
    Then the sidebar highlights "python-examples" under external sets
    And the main panel shows the external set detail for "python-examples"

  # ============================================================================
  # URL Routing — With Batch ID (Scroll-to-Batch)
  # ============================================================================

  @integration
  Scenario: Navigating to /simulations/run-plans/:suiteSlug/:batchId loads suite and highlights batch
    Given suite "critical-path" exists with batch runs:
      | batchRunId                        |
      | scenariobatch_oldest              |
      | scenariobatch_target              |
      | scenariobatch_newest              |
    When I navigate to "/my-project/simulations/run-plans/critical-path/scenariobatch_target"
    Then the main panel shows the suite detail for "critical-path"
    And the batch row for "scenariobatch_target" is highlighted with a yellow flash
    And the page scrolls to the "scenariobatch_target" row

  @integration
  Scenario: No scroll when target batch is already the first row
    Given suite "critical-path" exists with batch runs:
      | batchRunId                        |
      | scenariobatch_newest              |
      | scenariobatch_older               |
    When I navigate to "/my-project/simulations/run-plans/critical-path/scenariobatch_newest"
    Then the batch row for "scenariobatch_newest" is highlighted with a yellow flash
    And no scrolling occurs because it is already at the top

  @integration
  Scenario: Navigating to /simulations/:externalSetSlug/:batchId highlights batch in external set
    Given external set "python-examples" exists with batch runs:
      | batchRunId                        |
      | scenariobatch_first               |
      | scenariobatch_second              |
    When I navigate to "/my-project/simulations/python-examples/scenariobatch_second"
    Then the main panel shows the external set detail for "python-examples"
    And the batch row for "scenariobatch_second" is highlighted with a yellow flash

  @integration
  Scenario: Yellow flash fades after a short duration
    Given I navigated to a page with a highlighted batch
    When 2 seconds have elapsed
    Then the yellow flash highlight is no longer visible

  # ============================================================================
  # Sidebar Navigation
  # ============================================================================

  @integration
  Scenario: Clicking a suite in the sidebar navigates to /simulations/run-plans/:slug
    Given suite "critical-path" exists in the project
    When I am on the simulations page
    And I click "critical-path" in the sidebar
    Then the URL changes to "/my-project/simulations/run-plans/critical-path"
    And the main panel shows the suite detail

  @integration
  Scenario: Clicking an external set in the sidebar navigates to /simulations/:setSlug
    Given external set "python-examples" exists in the project
    When I am on the simulations page
    And I click "python-examples" in the sidebar
    Then the URL changes to "/my-project/simulations/python-examples"
    And the main panel shows the external set detail

  @integration
  Scenario: Clicking "All Runs" navigates to /simulations
    Given I am viewing a specific suite at "/my-project/simulations/run-plans/critical-path"
    When I click "All Runs" in the sidebar
    Then the URL changes to "/my-project/simulations"
    And the main panel shows the all-runs view

  # ============================================================================
  # SDK Compatibility
  # ============================================================================

  @integration
  Scenario: SDK-generated URL lands on unified page with external set selected
    Given the scenario SDK posts events for external set "python-examples"
    And the API returns URL "https://app.langwatch.ai/my-project/simulations/python-examples"
    When the SDK opens "https://app.langwatch.ai/my-project/simulations/python-examples/scenariobatch_abc123"
    Then the unified simulations page loads
    And external set "python-examples" is selected in the sidebar
    And batch "scenariobatch_abc123" is highlighted with a yellow flash

  # ============================================================================
  # Old URL Redirects
  # ============================================================================

  @integration
  Scenario: Old suites URL with suite param redirects to new path
    When I navigate to "/my-project/simulations/suites?suite=critical-path"
    Then I am redirected to "/my-project/simulations/run-plans/critical-path"

  @integration
  Scenario: Old suites URL with externalSet param redirects to new path
    When I navigate to "/my-project/simulations/suites?externalSet=python-examples"
    Then I am redirected to "/my-project/simulations/python-examples"

  @integration
  Scenario: Old suites URL without params redirects to simulations root
    When I navigate to "/my-project/simulations/suites"
    Then I am redirected to "/my-project/simulations"

  @integration
  Scenario: Old individual run URL redirects to unified page with drawer
    When I navigate to "/my-project/simulations/python-examples/scenariobatch_abc/scenariorun_xyz"
    Then I am redirected to "/my-project/simulations/python-examples/scenariobatch_abc?openRun=scenariorun_xyz"
    And the scenario run detail drawer opens for "scenariorun_xyz"

  # ============================================================================
  # Save and Run Redirect
  # ============================================================================

  @integration
  Scenario: Save and Run from scenario drawer redirects to simulations page
    Given I am on the scenarios library page
    And I open the scenario editor drawer for a scenario
    When I click "Save and Run" with a valid target selected
    Then the drawer closes
    And I am navigated to "/my-project/simulations"
    And the new run appears in the All Runs list via live updates

  # ============================================================================
  # Pending Run Placeholder
  # ============================================================================

  @integration
  Scenario: Initializing placeholder shown while run starts from suite detail
    Given I am viewing suite "critical-path" detail
    When I click "Run" in the suite header
    Then an "Initializing run..." placeholder row appears at the top of the run list
    And the placeholder disappears when the new batch run data arrives
