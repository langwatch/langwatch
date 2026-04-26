@traces @saved-views
Feature: Saved Views on Traces List
  As a LangWatch user
  I want quick-access filter presets on the traces page
  So that I can switch between common views with one click

  # ─── Design Decisions ───────────────────────────────────────────────
  #
  # Naming: "Saved Views" — a view captures the full filter state (filters,
  # search query, topics). "Filters" is too narrow (users can also save
  # search text and topic selections). "Searches" implies full-text only.
  # The UI label on the bar is just the view name — no header needed.
  #
  # Storage: Database (PostgreSQL) per project via tRPC endpoints.
  # Views are shared across all team members in a project — this is a
  # collaborative feature. The selected view ID is stored in localStorage
  # per user (personal preference, not shared state).
  #
  # Architecture: Three-layer pattern (Router → Service → Repository)
  # following the dashboard pattern. All Prisma queries MUST include
  # projectId for multitenancy protection.
  #
  # Seed views: On first access (getAll returns empty), the service
  # auto-creates 4 origin-based views (Application, Evaluations,
  # Simulations, Playground). These are regular views that can be
  # renamed, deleted, and reordered by any team member.
  #
  # "All Traces" is a virtual view (never stored in DB). It acts as a
  # full reset — clears field filters, search query, and negateFilters.
  # Uses a dedicated resetAllFilters() function, not the existing
  # clearFilters() which only handles field filters.
  #
  # Clicking the currently-active view deselects it (same as clicking
  # All Traces).
  #
  # Filter state captured: the `filters` object from useFilterParams plus
  # the `query` search string plus date period. Period is stored as
  # relativeDays for rolling windows, or fixed ISO dates for custom ranges.
  # Grouping and negateFilters are NOT captured.
  #
  # Origin filter infrastructure: `langwatch.origin` must be registered as
  # a filterable field (traces.origin) in the filter registry, ClickHouse
  # filter definitions, and filter conditions. The "application" value is
  # absence-based — traces with no origin attribute are "application".
  #
  # Feature gate: The saved views bar and origin column are only shown
  # for projects with ClickHouse enabled (featureClickHouseDataSourceTraces).
  #
  # Colors: Origin values use colors from featureIcons. Custom/user-defined
  # view names use getColorForString hash-based colors.
  #
  # Edit mode: blocks click-to-filter navigation. Users must exit edit
  # mode before clicking views to apply filters. Reordering uses
  # drag-and-drop for natural UX.
  # ─────────────────────────────────────────────────────────────────────

  Background:
    Given I am on the traces list page for my project
    And the project has ClickHouse enabled for traces

  # ─── Step 0: Origin Filter Infrastructure ───────────────────────────

  @integration @unimplemented
  Scenario: Origin filter is available in the filter sidebar
    When I open the filter sidebar
    Then I see an "Origin" filter option
    And it lists the available origin values with counts

  @unit @unimplemented
  Scenario: ClickHouse origin aggregation labels empty values as "application"
    Given the ClickHouse filter definition for "traces.origin"
    When the aggregation query runs
    Then traces with empty origin appear with label "application"
    And traces with origin "evaluation" appear with label "evaluation"

  # ─── Step 0b: Origin Column in Table View ───────────────────────────

  @integration @unimplemented
  Scenario: Origin column appears in table view
    When I switch to table view
    Then I see an "Origin" column
    And each row shows the trace's origin as a colored badge
    And the badge color matches the centralized origin color mapping

  @integration @unimplemented
  Scenario: Origin column shows "application" for traces without explicit origin
    Given a trace exists with no langwatch.origin attribute
    When I view it in table view
    Then the Origin column shows "application" with the traces blue color

  @unit @unimplemented
  Scenario: Origin colors follow centralized featureIcons mapping
    Then the origin color mapping is:
      | origin      | color       | source concept |
      | application | blue.500    | traces         |
      | evaluation  | orange.500  | evaluations    |
      | simulation  | pink.500    | simulations    |
      | playground  | purple.500  | prompts        |
      | workflow    | green.500   | workflows      |

  # ─── Step 0c: Feature Gate ──────────────────────────────────────────

  @integration @unimplemented
  Scenario: Saved views bar hidden when ClickHouse is not enabled
    Given the project does not have ClickHouse enabled for traces
    When the traces list page renders
    Then the saved views bar is not shown
    And the Origin column is not available in table view

  # ─── Step 1: Bottom Bar with Default Views ──────────────────────────

  @integration @unimplemented
  Scenario: Default origin-based views appear on first visit
    Given the project has no saved views in the database
    When the saved views bar renders
    Then I see a fixed bar at the bottom of the page
    And I see the following view badges in order:
      | All Traces   |
      | Application  |
      | Evaluations  |
      | Simulations  |
      | Playground   |
    And "All Traces" appears visually selected by default
    And each default badge has its corresponding origin color

  @integration @unimplemented
  Scenario: Clicking "All Traces" resets all filters including search query
    Given the "Evaluations" view is currently selected
    And the search query is set to "error timeout"
    When I click the "All Traces" view badge
    Then all field filters are cleared
    And the search query is cleared
    And the traces list shows all traces without any filtering
    And "All Traces" appears selected

  # ─── Step 2: Saving Custom Views ────────────────────────────────────

  @integration @unimplemented
  Scenario: Save current filters as a new view
    Given I have applied filters for model "gpt-4" and label "production"
    When I open the filter sidebar
    Then I see a "Save as view" button at the bottom of the sidebar
    When I click "Save as view"
    Then a dialog opens with a name input
    When I type "GPT-4 Production" and click Save
    Then a new "GPT-4 Production" badge appears in the saved views bar
    And it appears after the existing views
    And it is automatically selected
    And its color is determined by getColorForString hash
    And the view is persisted in the database

  @integration @unimplemented
  Scenario: Saved view captures filters, search query, and date period
    Given I have set the search query to "error timeout"
    And I have filtered by user_id "user-123"
    And I have selected "Last 30 days" as the date range
    When I save the current state as a view named "Timeout Errors"
    And I click "All Traces" to reset
    And I click the "Timeout Errors" view badge
    Then the search query is restored to "error timeout"
    And the user_id filter is restored to "user-123"
    And the date range is restored to approximately 30 days

  @integration @unimplemented
  Scenario: Saved views are shared across team members
    Given user A saves a view named "Critical Errors" with error filters
    When user B loads the traces page for the same project
    Then user B sees the "Critical Errors" badge in the saved views bar
    And clicking it applies the same filters

  # ─── Step 3: Database Persistence ───────────────────────────────────

  @integration @unimplemented
  Scenario: Views are scoped to project by projectId
    Given I have saved views for project "proj-alpha"
    When I switch to project "proj-beta"
    Then I only see the seed views for "proj-beta"
    And the custom views from "proj-alpha" do not appear

  # ─── Step 4: Edit Mode ─────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Entering edit mode via three-dot menu
    Given I have saved custom views
    When I click the vertical three-dot menu at the far right of the bar
    Then I see an "Edit" option in the dropdown
    When I click "Edit"
    Then the bar enters edit mode
    And each custom view badge shows a small "x" delete button
    And a hint "Double click to rename" appears in gray text
    And "All Traces" does not show a delete button

  @integration @unimplemented
  Scenario: Clicking a view in edit mode does not apply filters
    Given the bar is in edit mode
    When I click a custom view badge
    Then the filters do not change
    And the click is ignored for filter purposes

  @integration @unimplemented
  Scenario: Renaming a saved view by double-clicking
    Given the bar is in edit mode
    When I double-click the "GPT-4 Production" badge label
    Then the label becomes an editable text input
    When I type "GPT-4 Prod" and press Enter
    Then the badge label updates to "GPT-4 Prod"
    And the change is persisted to the database

  @integration @unimplemented
  Scenario: Deleting a saved view
    Given the bar is in edit mode
    And I have a custom view "Old View"
    When I click the "x" button on the "Old View" badge
    And I confirm the deletion
    Then the "Old View" badge is removed from the bar
    And it is removed from the database
    And if "Old View" was the active view, "All Traces" becomes selected

  @integration @unimplemented
  Scenario: Reordering custom views by drag-and-drop
    Given the bar is in edit mode
    And I have custom views "View A", "View B", "View C" in that order
    When I drag "View C" before "View A"
    Then the order becomes "View C", "View A", "View B"
    And the new order is persisted to the database
    And all team members see the updated order

  @integration @unimplemented
  Scenario: Exiting edit mode
    Given the bar is in edit mode
    When I click "Done"
    Then the bar exits edit mode
    And delete buttons and hint text disappear
    And the views function normally for click-to-filter

  # ─── Step 5: View Matching and Edge Cases ───────────────────────────

  @unit @unimplemented
  Scenario: Manually changing filters deselects the active view
    Given the "Application" view is currently selected
    When I manually add a model filter in the sidebar
    Then no saved view badge appears selected

  @unit @unimplemented
  Scenario: Maximum view name length
    When I try to save a view with a name longer than 50 characters
    Then the name is truncated to 50 characters

  @unit @unimplemented
  Scenario: Empty custom views list shows only All Traces plus seeds
    Given the project has no saved views in the database
    When the bar renders
    Then seed views are created and shown alongside "All Traces"
    And the three-dot menu is still visible

