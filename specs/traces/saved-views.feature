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
  # Storage: localStorage per project (keyed by projectId, not slug).
  # Includes schemaVersion for future migration support. No backend
  # persistence yet — keeps scope small, avoids migrations.
  #
  # Default views filter on `langwatch.origin` (trace-type-classification).
  # They are always present and cannot be deleted, only hidden in the future.
  #
  # "All Traces" acts as a full reset — clears field filters, search query,
  # and negateFilters. Uses a dedicated resetAllFilters() function, not
  # the existing clearFilters() which only handles field filters.
  #
  # Clicking the currently-active view deselects it (same as clicking All Traces).
  #
  # Filter state captured: the `filters` object from useFilterParams plus
  # the `query` search string. Period (date range), grouping, and
  # negateFilters are NOT captured — date/grouping are orthogonal concerns;
  # negateFilters is excluded to avoid silent inversion bugs.
  #
  # Origin filter infrastructure: `langwatch.origin` must be registered as
  # a filterable field (traces.origin) in the filter registry, ClickHouse
  # filter definitions, and filter conditions. The "application" value is
  # absence-based — traces with no origin attribute are "application".
  # The filter must handle this: filtering for "application" means
  # origin = '' OR origin IS NULL, while other values match directly.
  #
  # Feature gate: The saved views bar and origin column are only shown
  # for projects with ClickHouse enabled (featureClickHouseDataSourceTraces).
  # The origin data only exists in ClickHouse trace_summaries, not in
  # Elasticsearch, so the feature requires ClickHouse.
  #
  # Colors: Origin values use colors from featureIcons (the centralized
  # color/icon mapping for platform concepts):
  #   - application: blue.500 (traces)
  #   - evaluation: orange.500 (evaluations)
  #   - simulation: pink.500 (simulations)
  #   - playground: purple.500 (prompts)
  #   - workflow: green.500 (workflows)
  # Custom/user-defined view names use getColorForString hash-based colors.
  # This mapping lives in a centralized originColors config, not inline.
  #
  # Edit mode: blocks click-to-filter navigation. Users must exit edit
  # mode before clicking views to apply filters. Reordering uses
  # drag-and-drop for natural UX.
  # ─────────────────────────────────────────────────────────────────────

  Background:
    Given I am on the traces list page for my project
    And the project has ClickHouse enabled for traces

  # ─── Step 0: Origin Filter Infrastructure ───────────────────────────
  # The saved views bar depends on the ability to filter by trace origin.
  # This requires registering `traces.origin` as a filter field across
  # the filter system (types, Elasticsearch, ClickHouse, sidebar UI).

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
    Given I have not saved any custom views
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
    Then a name input appears
    When I type "GPT-4 Production" and confirm
    Then a new "GPT-4 Production" badge appears in the saved views bar
    And it appears after the default origin views
    And it is automatically selected
    And its color is determined by getColorForString hash

  @integration
  Scenario: Saved view captures filters and search query
    Given I have set the search query to "error timeout"
    And I have filtered by user_id "user-123"
    When I save the current state as a view named "Timeout Errors"
    And I click "All Traces" to reset
    And I click the "Timeout Errors" view badge
    Then the search query is restored to "error timeout"
    And the user_id filter is restored to "user-123"

  @unit
  Scenario: Saved view does not capture date range, grouping, or negation
    When I save filters with a date range, grouping "thread_id", and negateFilters on
    Then the saved view object contains only filters and query
    And it does not contain startDate, endDate, group_by, or negateFilters

  # ─── Step 3: localStorage Persistence ───────────────────────────────

  @unit
  Scenario: Selected view persists across page reloads
    Given I have clicked the "Application" view badge
    When I reload the page
    Then the "Application" view is still selected
    And the origin filter for "application" is still applied

  @unit
  Scenario: Custom views persist across page reloads
    Given I have saved a custom view "My Debug View"
    When I reload the page
    Then the "My Debug View" badge still appears in the bar

  @unit
  Scenario: Views are scoped to project by projectId
    Given I have saved views for project with id "proj-alpha"
    When I switch to project with id "proj-beta"
    Then I only see the default views
    And the custom views from "proj-alpha" do not appear

  @unit
  Scenario: localStorage includes schema version for future migration
    When I save a custom view
    Then the localStorage data includes a schemaVersion field

  @unit
  Scenario: Corrupt localStorage gracefully falls back to defaults
    Given localStorage contains unparseable saved views data
    When the saved views bar renders
    Then only the default views appear
    And the corrupt data is replaced with fresh defaults

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
    And default origin views do not show delete buttons

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
    And the change is persisted to localStorage

  @integration
  Scenario: Deleting a saved view
    Given the bar is in edit mode
    And I have a custom view "Old View"
    When I click the "x" button on the "Old View" badge
    Then the "Old View" badge is removed from the bar
    And it is removed from localStorage
    And if "Old View" was the active view, "All Traces" becomes selected

  @integration
  Scenario: Cannot delete default views
    Given the bar is in edit mode
    Then the "All Traces" badge does not show an "x" button
    And the "Application" badge does not show an "x" button
    And the "Evaluations" badge does not show an "x" button

  @integration
  Scenario: Reordering custom views by drag-and-drop
    Given the bar is in edit mode
    And I have custom views "View A", "View B", "View C" in that order
    When I drag "View C" before "View A"
    Then the order becomes "View C", "View A", "View B"
    And the new order is persisted to localStorage

  @integration
  Scenario: Exiting edit mode
    Given the bar is in edit mode
    When I click the three-dot menu and select "Done"
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
    # The bar shows no selection — the user has a custom unsaved filter state

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
  Scenario: Empty custom views list shows only defaults
    Given localStorage has no saved views for this project
    When the bar renders
    Then only the 5 default origin views appear
    And the three-dot menu is still visible
