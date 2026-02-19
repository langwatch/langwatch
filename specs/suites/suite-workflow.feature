Feature: Suite Workflow — Create, Run, See Results
  As a LangWatch user
  I want to create suites of scenarios and targets, trigger runs, and view results
  So that I can batch-test my agents against curated scenario sets

  See mockups.md for UI reference.

  Background:
    Given I am logged into project "my-project"
    And the feature flag "release_ui_suites_enabled" is enabled

  # ============================================================================
  # Navigation & Feature Flag
  # ============================================================================

  @integration
  Scenario: Suites nav link visible when feature flag enabled
    When I view the main navigation
    Then I see a "Suites" link under Simulations

  @integration
  Scenario: Suites nav link hidden when feature flag disabled
    Given the feature flag "release_ui_suites_enabled" is disabled
    When I view the main navigation
    Then I do not see a "Suites" link

  @integration
  Scenario: Navigate to suites page
    When I click "Suites" in the main navigation
    Then I am on the suites page
    And I see the sidebar with "+ New Suite" button
    And I see "All Runs" link in the sidebar

  # ============================================================================
  # Empty State
  # ============================================================================

  @integration
  Scenario: Empty state when no suites exist
    Given no suites exist in the project
    When I am on the suites page
    Then the main panel shows "Select a suite or create one"

  # ============================================================================
  # Create Suite — Drawer
  # ============================================================================

  @integration
  Scenario: Open new suite drawer
    When I click "+ New Suite" in the sidebar
    Then a drawer opens with title "New Suite"
    And I see fields for Name, Description, Labels, Scenarios, and Targets
    And I see "Execution Options" and "Triggers" sections
    And I see "Save" and "Run Now" buttons

  @e2e
  Scenario: Create a suite with name, scenarios, and targets
    Given scenarios exist in the project:
      | name                  | labels              |
      | Angry refund request  | ["critical"]        |
      | Policy violation      | ["critical"]        |
      | Edge: empty cart      | ["edge"]            |
    And targets exist in the project:
      | name             | type   |
      | Production Agent | HTTP   |
    When I click "+ New Suite" in the sidebar
    And I enter "Critical Path" as the suite name
    And I select scenarios "Angry refund request" and "Policy violation"
    And I select target "Production Agent"
    And I click "Save"
    Then the drawer closes
    And "Critical Path" appears in the sidebar

  @integration
  Scenario: Drawer validates required fields
    When I click "+ New Suite" in the sidebar
    And I click "Save" without filling any fields
    Then I see a validation error for Name
    And I see a validation error for Scenarios
    And I see a validation error for Targets

  @integration
  Scenario: Drawer validates at least one scenario selected
    When I click "+ New Suite" in the sidebar
    And I enter "My Suite" as the suite name
    And I select target "Production Agent"
    And I click "Save" without selecting any scenarios
    Then I see a validation error for Scenarios

  @integration
  Scenario: Drawer validates at least one target selected
    When I click "+ New Suite" in the sidebar
    And I enter "My Suite" as the suite name
    And I select scenario "Angry refund request"
    And I click "Save" without selecting any targets
    Then I see a validation error for Targets

  # ============================================================================
  # Create Suite — Scenario Search & Filter
  # ============================================================================

  @integration
  Scenario: Search scenarios in the drawer
    Given scenarios exist in the project:
      | name                  | labels              |
      | Angry refund request  | ["critical"]        |
      | Policy violation      | ["critical"]        |
      | Edge: empty cart      | ["edge"]            |
    When I open the new suite drawer
    And I type "refund" in the scenario search box
    Then only "Angry refund request" is shown in the scenario list

  @integration
  Scenario: Filter scenarios by label in the drawer
    Given scenarios exist with labels "critical", "billing", and "edge"
    When I open the new suite drawer
    And I click the "#critical" label chip
    Then only scenarios with the "critical" label are shown

  @integration
  Scenario: Select All and Clear scenarios
    Given 5 scenarios exist in the project
    When I open the new suite drawer
    And I click "Select All" in the scenarios section
    Then all 5 scenarios are selected
    And the counter shows "5 of 5 selected"
    When I click "Clear"
    Then no scenarios are selected
    And the counter shows "0 of 5 selected"

  # ============================================================================
  # Create Suite — Target Search
  # ============================================================================

  @integration
  Scenario: Search targets in the drawer
    Given targets exist in the project:
      | name             | type   |
      | Production Agent | HTTP   |
      | Support Bot v2   | Prompt |
      | Claude Sonnet    | HTTP   |
    When I open the new suite drawer
    And I type "support" in the target search box
    Then only "Support Bot v2" is shown in the target list

  @integration
  Scenario: Target list shows type indicator
    Given targets exist in the project:
      | name             | type   |
      | Production Agent | HTTP   |
      | Support Bot v2   | Prompt |
    When I open the new suite drawer
    Then "Production Agent" shows type "(HTTP)"
    And "Support Bot v2" shows type "(Prompt)"

  # ============================================================================
  # Create Suite — Execution Options (Repeat Count)
  # ============================================================================

  @integration
  Scenario: Set repeat count in execution options
    When I open the new suite drawer
    And I expand "Execution Options"
    Then I see a "Repeat count" field defaulting to 1
    When I set repeat count to 3
    And I fill in name, scenarios, and targets
    And I click "Save"
    Then the suite detail page shows "3× trials"

  @integration
  Scenario: Repeat count appears in suite stats bar
    Given suite "Critical Path" exists with repeat count 3
    When I select "Critical Path" in the sidebar
    Then the stats bar shows "3× trials"

  # ============================================================================
  # Edit Suite
  # ============================================================================

  @e2e
  Scenario: Edit suite via header button
    Given suite "Critical Path" exists with 3 scenarios and 1 target
    When I select "Critical Path" in the sidebar
    And I click "Edit" in the suite header
    Then the edit drawer opens with title "Edit Suite"
    And the name field contains "Critical Path"
    And 3 scenarios are pre-selected
    And 1 target is pre-selected

  @e2e
  Scenario: Edit suite via context menu
    Given suite "Critical Path" exists
    When I right-click "Critical Path" in the sidebar
    And I click "Edit" in the context menu
    Then the edit drawer opens

  # ============================================================================
  # Suite Context Menu
  # ============================================================================

  @integration
  Scenario: Context menu actions on sidebar suite item
    Given suite "Critical Path" exists
    When I right-click "Critical Path" in the sidebar
    Then I see a context menu with "Edit", "Duplicate", and "Delete"

  @e2e
  Scenario: Duplicate suite
    Given suite "Critical Path" exists with 3 scenarios and 1 target
    When I right-click "Critical Path" in the sidebar
    And I click "Duplicate"
    Then a new suite "Critical Path (copy)" appears in the sidebar
    And it has the same scenarios and targets as the original

  @e2e
  Scenario: Delete suite
    Given suite "Critical Path" exists
    When I right-click "Critical Path" in the sidebar
    And I click "Delete"
    Then I see a confirmation dialog
    When I confirm deletion
    Then "Critical Path" is removed from the sidebar

  # ============================================================================
  # Run Suite
  # ============================================================================

  @e2e
  Scenario: Run suite from sidebar button
    Given suite "Critical Path" exists with 2 scenarios and 1 target
    When I click "Run" next to "Critical Path" in the sidebar
    Then "Critical Path" is selected in the sidebar
    And a new run appears in the run history

  @e2e
  Scenario: Run suite from header button
    Given suite "Critical Path" is selected
    When I click the "Run" button in the suite header
    Then a new run appears in the run history

  @e2e
  Scenario: Save and run from drawer
    Given I have filled in the new suite drawer with valid data
    When I click "Run Now"
    Then the suite is saved
    And a run is triggered immediately
    And I see the suite selected with the new run in the run history

  # ============================================================================
  # Run Suite — Job Scheduling
  # ============================================================================

  @unit
  Scenario: Suite run generates correct number of jobs
    Given a suite with 3 scenarios, 2 targets, and repeat count 1
    When the suite run is triggered
    Then 6 jobs are scheduled (3 scenarios × 2 targets)

  @unit
  Scenario: Suite run respects repeat count
    Given a suite with 2 scenarios, 1 target, and repeat count 3
    When the suite run is triggered
    Then 6 jobs are scheduled (2 scenarios × 1 target × 3 repeats)

  @unit
  Scenario: Suite run uses suite ID as setId
    Given a suite with id "suite_abc123"
    When the suite run is triggered
    Then all jobs are scheduled with a suite-namespaced setId

  @unit
  Scenario: Suite run validates scenario references before scheduling
    Given a suite references scenario "deleted-scenario" that no longer exists
    When the suite run is triggered
    Then the run fails with an error about invalid scenario references

  @unit
  Scenario: Suite run validates target references before scheduling
    Given a suite references target "removed-target" that no longer exists
    When the suite run is triggered
    Then the run fails with an error about invalid target references

  # ============================================================================
  # Run History — Queue Status Visibility
  # ============================================================================
  #
  # When a suite run is scheduled, jobs are queued in BullMQ (Redis).
  # The RunHistoryList shows a status banner while jobs are pending/active.
  #

  @unit
  Scenario: Queue status returns counts for pending and active jobs
    Given a suite "Critical Path" has 3 pending and 1 active job in the queue
    When I query the queue status for "Critical Path"
    Then the status shows 3 waiting and 1 active

  @unit
  Scenario: Queue status returns zero counts when no jobs are queued
    Given a suite "Critical Path" has no jobs in the queue
    When I query the queue status for "Critical Path"
    Then the status shows 0 waiting and 0 active

  @integration
  Scenario: Queue status banner appears when jobs are pending
    Given a suite has 2 pending and 1 active job
    When I view the run history
    Then I see a status banner showing "2 pending, 1 running"
    And the banner includes a spinner

  @integration
  Scenario: Queue status banner disappears when all jobs complete
    Given a suite has 0 pending and 0 active jobs
    When I view the run history
    Then I do not see a queue status banner

  # ============================================================================
  # Run History List
  # ============================================================================
  #
  # The main content area shows a run history list. Each row is a **run**
  # (not an individual scenario×target pair). Runs are collapsible — expanding
  # shows the scenario × target breakdown as a summary preview.
  # Clicking a run navigates to the existing run detail page.
  # Results are fetched from ElasticSearch filtered by the suite's setId.
  #

  @e2e
  Scenario: View run history after suite run completes
    Given suite "Critical Path" has a completed run with all passing
    When I select "Critical Path" in the sidebar
    Then the main panel shows the suite header with name and stats
    And I see a run history list below the header
    And the most recent run row shows the timestamp and overall pass rate

  @integration
  Scenario: Run row shows timestamp, pass rate, and trigger type
    Given suite "Critical Path" has a run triggered manually 2 hours ago at 100% pass rate
    When I view the run history
    Then I see a run row with "2 hours ago", "100%", and "Manual"

  @integration
  Scenario: Expand run to see scenario × target breakdown
    Given suite "Critical Path" has a completed run
    When I expand the run row
    Then I see scenario × target pairs like "Angry refund × Prod Agent"
    And each pair shows pass percentage, trial count, and duration

  @integration
  Scenario: Expanded run shows repeat trial counts
    Given suite "Critical Path" has repeat count 3
    And all trials passed for "Angry refund × Prod Agent"
    When I expand the run row
    Then I see "100% (3/3)" for that pair

  @integration
  Scenario: Most recent run is expanded by default
    Given suite "Critical Path" has 2 completed runs
    When I view the run history
    Then the most recent run is expanded
    And the older run is collapsed

  @integration
  Scenario: Collapse and expand run rows
    Given suite "Critical Path" has 2 completed runs
    When I click the expanded run header
    Then it collapses
    When I click the collapsed run header
    Then it expands to show its scenario × target breakdown

  @integration
  Scenario: Click run row navigates to run detail page
    Given suite "Critical Path" has a completed run
    When I click on a scenario × target pair inside an expanded run
    Then I am navigated to the existing run detail page for that run

  # ============================================================================
  # Run History — Filters
  # ============================================================================

  @integration
  Scenario: Filter run history by scenario
    Given suite "Critical Path" has results for 5 scenarios
    When I select a scenario from the "Scenario" filter dropdown
    Then only runs containing that scenario are shown

  @integration
  Scenario: Filter run history by target
    Given suite "Critical Path" has results for 2 targets
    When I select a target from the "Target" filter dropdown
    Then only runs containing that target are shown

  @integration
  Scenario: Filter run history by pass/fail status
    Given suite "Critical Path" has both passing and failing runs
    When I select "Fail" from the "Pass/Fail" filter
    Then only runs with failures are shown

  # ============================================================================
  # Run History — Summary Stats
  # ============================================================================

  @integration
  Scenario: Sidebar shows pass count and recency for each suite
    Given suite "Critical Path" last ran 2 hours ago with 8/8 passing
    When I view the sidebar
    Then "Critical Path" shows "8/8 passed · 2h ago"

  @integration
  Scenario: Sidebar shows failure indicator when some fail
    Given suite "Billing Edge" last ran with 9/12 passing
    When I view the sidebar
    Then "Billing Edge" shows "9/12 passed" with a failure indicator

  @integration
  Scenario: Run history footer shows totals
    Given suite "Critical Path" has 3 runs with 21 passed and 3 failed total
    When I view the run history
    Then the footer shows "3 runs" and "21 passed" and "3 failed"

  # ============================================================================
  # Sidebar Search
  # ============================================================================

  @integration
  Scenario: Search suites in the sidebar
    Given suites "Critical Path", "Billing Edge", and "Quick Run" exist
    When I type "billing" in the sidebar search box
    Then only "Billing Edge" is shown in the sidebar list

  # ============================================================================
  # Layout Consistency (Issue #1671)
  # ============================================================================

  @integration
  Scenario: Suite page uses standard PageLayout header
    When I am on the suites page
    Then I see a "Suites" heading at the top of the page
    And the sidebar does not show a duplicate "Suites" label

  @integration
  Scenario: Suite page sidebar fills available height below header
    When I am on the suites page with many suites
    Then the sidebar scrolls independently within its bounded height
    And the main panel scrolls independently

  @integration
  Scenario: DashboardLayout wraps the page exactly once
    When I am on the suites page
    Then the standard page layout and navigation appear exactly once
