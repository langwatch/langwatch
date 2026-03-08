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

  @integration
  Scenario: Origin filter is available in the filter sidebar
    When I open the filter sidebar
    Then I see an "Origin" filter option
    And it lists the available origin values with counts

  @unit
  Scenario: ClickHouse origin filter for "application" matches absent values
    Given the ClickHouse filter condition builder for "traces.origin"
    When I build a condition for values ["application"]
    Then the SQL checks for empty or null origin attribute
    And it does not use a simple IN clause with "application"

  @unit
  Scenario: ClickHouse origin filter for specific values
    Given the ClickHouse filter condition builder for "traces.origin"
    When I build a condition for values ["evaluation"]
    Then the SQL uses an IN clause matching the attribute value

  @unit
  Scenario: ClickHouse origin filter for mixed values including "application"
    Given the ClickHouse filter condition builder for "traces.origin"
    When I build a condition for values ["application", "evaluation"]
    Then the SQL combines an absence check OR an IN clause

  @unit
  Scenario: ClickHouse origin aggregation labels empty values as "application"
    Given the ClickHouse filter definition for "traces.origin"
    When the aggregation query runs
    Then traces with empty origin appear with label "application"
    And traces with origin "evaluation" appear with label "evaluation"

  # ─── Step 0b: Origin Column in Table View ───────────────────────────

  @integration
  Scenario: Origin column appears in table view
    When I switch to table view
    Then I see an "Origin" column
    And each row shows the trace's origin as a colored badge
    And the badge color matches the centralized origin color mapping

  @integration
  Scenario: Origin column shows "application" for traces without explicit origin
    Given a trace exists with no langwatch.origin attribute
    When I view it in table view
    Then the Origin column shows "application" with the traces blue color

  @unit
  Scenario: Origin colors follow centralized featureIcons mapping
    Then the origin color mapping is:
      | origin      | color       | source concept |
      | application | blue.500    | traces         |
      | evaluation  | orange.500  | evaluations    |
      | simulation  | pink.500    | simulations    |
      | playground  | purple.500  | prompts        |
      | workflow    | green.500   | workflows      |

  # ─── Step 0c: Feature Gate ──────────────────────────────────────────

  @integration
  Scenario: Saved views bar hidden when ClickHouse is not enabled
    Given the project does not have ClickHouse enabled for traces
    When the traces list page renders
    Then the saved views bar is not shown
    And the Origin column is not available in table view

  # ─── Step 1: Bottom Bar with Default Views ──────────────────────────

  @integration
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

  @integration
  Scenario: Seed views are created in the database on first access
    Given the project has no saved views in the database
    When a team member loads the traces page
    Then 4 seed views are created in the database for the project
    And they are visible to all team members

  @integration
  Scenario: Clicking a default view filters traces by origin
    When I click the "Application" view badge
    Then the traces list filters to show only traces where origin is "application"
    And the "Application" badge appears selected
    And the "All Traces" badge appears deselected

  @integration
  Scenario: Clicking "All Traces" resets all filters including search query
    Given the "Evaluations" view is currently selected
    And the search query is set to "error timeout"
    When I click the "All Traces" view badge
    Then all field filters are cleared
    And the search query is cleared
    And the traces list shows all traces without any filtering
    And "All Traces" appears selected

  @integration
  Scenario: Clicking the active view deselects it
    Given the "Simulations" view is currently selected
    When I click the "Simulations" view badge again
    Then the origin filter is cleared
    And "All Traces" appears selected

  # ─── Step 2: Saving Custom Views ────────────────────────────────────

  @integration
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

  @integration
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

  @integration
  Scenario: Saved views are shared across team members
    Given user A saves a view named "Critical Errors" with error filters
    When user B loads the traces page for the same project
    Then user B sees the "Critical Errors" badge in the saved views bar
    And clicking it applies the same filters

  # ─── Step 3: Database Persistence ───────────────────────────────────

  @integration
  Scenario: Views are stored in the database per project
    When I save a custom view "Debug View"
    Then the view exists in the SavedView table with the correct projectId
    And the filters are stored as JSON

  @integration
  Scenario: Selected view ID persists locally per user
    Given I have clicked the "Application" view badge
    When I reload the page
    Then the "Application" view is still selected for me
    But another team member may have a different view selected

  @integration
  Scenario: Views are scoped to project by projectId
    Given I have saved views for project "proj-alpha"
    When I switch to project "proj-beta"
    Then I only see the seed views for "proj-beta"
    And the custom views from "proj-alpha" do not appear

  @integration
  Scenario: Multitenancy protection on all endpoints
    Given a saved view belongs to project "proj-alpha"
    When I try to access it with projectId "proj-beta"
    Then the request returns not found
    And the view is not exposed to the wrong project

  # ─── Step 4: Edit Mode ─────────────────────────────────────────────

  @integration
  Scenario: Entering edit mode via three-dot menu
    Given I have saved custom views
    When I click the vertical three-dot menu at the far right of the bar
    Then I see an "Edit" option in the dropdown
    When I click "Edit"
    Then the bar enters edit mode
    And each custom view badge shows a small "x" delete button
    And a hint "Double click to rename" appears in gray text
    And "All Traces" does not show a delete button

  @integration
  Scenario: Clicking a view in edit mode does not apply filters
    Given the bar is in edit mode
    When I click a custom view badge
    Then the filters do not change
    And the click is ignored for filter purposes

  @integration
  Scenario: Renaming a saved view by double-clicking
    Given the bar is in edit mode
    When I double-click the "GPT-4 Production" badge label
    Then the label becomes an editable text input
    When I type "GPT-4 Prod" and press Enter
    Then the badge label updates to "GPT-4 Prod"
    And the change is persisted to the database

  @integration
  Scenario: Deleting a saved view
    Given the bar is in edit mode
    And I have a custom view "Old View"
    When I click the "x" button on the "Old View" badge
    And I confirm the deletion
    Then the "Old View" badge is removed from the bar
    And it is removed from the database
    And if "Old View" was the active view, "All Traces" becomes selected

  @integration
  Scenario: Reordering custom views by drag-and-drop
    Given the bar is in edit mode
    And I have custom views "View A", "View B", "View C" in that order
    When I drag "View C" before "View A"
    Then the order becomes "View C", "View A", "View B"
    And the new order is persisted to the database
    And all team members see the updated order

  @integration
  Scenario: Exiting edit mode
    Given the bar is in edit mode
    When I click "Done"
    Then the bar exits edit mode
    And delete buttons and hint text disappear
    And the views function normally for click-to-filter

  # ─── Step 5: View Matching and Edge Cases ───────────────────────────

  @unit
  Scenario: Applying a view updates URL params
    When I click the "Evaluations" view badge
    Then the URL query params reflect the origin filter
    And the filter sidebar shows the origin filter as active

  @unit
  Scenario: Manually changing filters deselects the active view
    Given the "Application" view is currently selected
    When I manually add a model filter in the sidebar
    Then no saved view badge appears selected

  @unit
  Scenario: Re-applying saved view's exact filters re-selects the badge
    Given a saved view "Debug" with filters model=["gpt-4"]
    When I manually set the model filter to ["gpt-4"] via the sidebar
    Then the "Debug" badge appears selected

  @unit
  Scenario: View matching ignores array order
    Given a saved view with model=["gpt-4", "claude-3"]
    When the URL has model=["claude-3", "gpt-4"]
    Then the saved view badge appears selected

  @integration
  Scenario: Page loads with URL filters not matching any saved view
    Given the URL contains filter params for "has_error=true"
    And no saved view matches those exact filters
    When the page renders
    Then no saved view badge appears selected
    And the filters from the URL are applied to the traces list

  @unit
  Scenario: Maximum view name length
    When I try to save a view with a name longer than 50 characters
    Then the name is truncated to 50 characters

  @unit
  Scenario: Empty custom views list shows only All Traces plus seeds
    Given the project has no saved views in the database
    When the bar renders
    Then seed views are created and shown alongside "All Traces"
    And the three-dot menu is still visible

  # ─── Step 6: tRPC Endpoints ─────────────────────────────────────────

  @integration
  Scenario: getAll returns views ordered by position
    Given the project has saved views in the database
    When I call savedViews.getAll with the projectId
    Then I receive all views for that project
    And they are ordered by the "order" field ascending

  @integration
  Scenario: create adds a new view at the end
    When I call savedViews.create with name, filters, and projectId
    Then a new view is created in the database
    And its order is after all existing views

  @integration
  Scenario: delete removes a view
    Given a saved view exists with id "view-1"
    When I call savedViews.delete with id "view-1" and projectId
    Then the view is removed from the database

  @integration
  Scenario: rename updates the view name
    Given a saved view exists with name "Old Name"
    When I call savedViews.rename with the new name "New Name"
    Then the view name is updated in the database

  @integration
  Scenario: reorder updates the order of all views
    Given views exist in order ["view-a", "view-b", "view-c"]
    When I call savedViews.reorder with ["view-c", "view-a", "view-b"]
    Then the order field is updated for each view
    And subsequent getAll returns them in the new order
