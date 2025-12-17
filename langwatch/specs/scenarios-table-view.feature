@wip
Feature: Scenarios Table View with Generic DataGrid
  As a LangWatch user
  I want to view my scenario execution results in a powerful table format
  So that I can filter, sort, search, group, and export scenario data efficiently

  Background:
    Given I am logged in as a user with scenarios:view permission
    And I have a project with scenario execution data
    And scenarios have associated traces with metadata
  # ============================================================================
  # View Navigation
  # ============================================================================

  @e2e
  Scenario: Switch between Grid View and Table View
    Given I am on the simulations page
    When I click on the Table View tab
    Then I see the scenarios displayed in a table format
    And the URL contains view=table parameter

  @e2e
  Scenario: Navigate to scenario set via linked ID
    Given I am on the simulations page in Table View
    When I click on a scenario set ID link
    Then I am navigated to the scenario set page
    And I see the grid view for that scenario set

  @e2e
  Scenario: Navigate to batch run via linked ID
    Given I am on the simulations page in Table View
    When I click on a batch run ID link
    Then I am navigated to the batch run page
    And I see the grid view for that batch run
  # ============================================================================
  # Expandable Rows
  # ============================================================================

  @integration
  Scenario: Expand row to see associated traces
    Given I am on the simulations page in Table View
    And there is a scenario run with multiple traces
    When I click the expand button on a row
    Then I see a nested table with all traces for that run
    And each trace shows its trace ID, input, output, and metadata

  @integration
  Scenario: Collapse expanded row
    Given I am on the simulations page in Table View
    And I have expanded a row
    When I click the expand button again
    Then the nested trace table is hidden

  @integration
  Scenario: Inherited metadata columns from traces
    Given I am on the simulations page in Table View
    And traces have metadata fields like user_id and session_id
    Then I see dynamic columns for metadata.user_id and metadata.session_id
    And these columns are hidden by default
    And I can show them via column visibility settings
  # ============================================================================
  # Column Popover Menu
  # ============================================================================

  @integration
  Scenario: Open column popover menu
    Given I am on the simulations page in Table View
    When I click on the Status column header dropdown 3 vertical dots
    Then I see a popover menu with sort, filter, and group options

  @integration
  Scenario: Sort column via popover
    Given I am on the simulations page in Table View
    And I open the Status column popover
    When I click Sort Ascending
    Then the table is sorted by status in ascending order
    And the URL contains sortBy=status and sortOrder=asc

  @integration
  Scenario: Filter enum column with equals operator
    Given I am on the simulations page in Table View
    And I open the Status column popover
    When I select FAILED from the filter dropdown
    And I click Apply
    Then I only see scenarios with FAILED status
    And the filter appears in the active filters bar

  @integration
  Scenario: Filter text column with contains operator
    Given I am on the simulations page in Table View
    And I open the Name column popover
    When I enter login in the filter text input
    And I click Apply
    Then I only see scenarios whose name contains login

  @integration
  Scenario: Add multiple filters to same column
    Given I am on the simulations page in Table View
    And I have filtered Status to FAILED
    When I add another filter for Status equals ERROR
    Then I see scenarios with either FAILED or ERROR status

  @integration
  Scenario: Remove filter from popover
    Given I am on the simulations page in Table View
    And I have a filter on Status column
    When I open the Status column popover
    And I click the remove button on the filter
    Then the filter is removed
    And all scenarios are displayed

  @integration
  Scenario: Group by column
    Given I am on the simulations page in Table View
    And I open the Status column popover
    When I check Group by Status
    Then the table rows are grouped by status
    And I see group headers for each status value
    And each group header shows count and pass rate

  @integration
  Scenario: Hide column via popover
    Given I am on the simulations page in Table View
    And I open the Status column popover
    When I click Hide Column
    Then the Status column is no longer visible
    And I can restore it via column visibility settings

  @integration
  Scenario: Pin column to left
    Given I am on the simulations page in Table View
    And I open the Name column popover
    When I click Pin to Left
    Then the Name column is pinned to the left side
    And it stays visible when scrolling horizontally
  # ============================================================================
  # Filter Bar
  # ============================================================================

  @integration
  Scenario: Add filter via filter bar
    Given I am on the simulations page in Table View
    When I click Add Filter button
    And I select Status column and FAILED value
    And I click Apply
    Then I only see scenarios with FAILED status

  @integration
  Scenario: Clear all filters
    Given I am on the simulations page in Table View
    And I have multiple filters applied
    When I click Clear All in the filter bar
    Then all filters are removed
    And all scenarios are displayed

  @integration
  Scenario: Global search
    Given I am on the simulations page in Table View
    When I enter login error in the search box
    Then I see scenarios whose name or content contains login error
  # ============================================================================
  # Dynamic Columns
  # ============================================================================

  @integration
  Scenario: Auto-generate columns from trace metadata
    Given I am on the simulations page in Table View
    And traces have metadata fields: user_id, session_id, environment
    Then the column visibility menu shows metadata.user_id, metadata.session_id, metadata.environment
    And these columns are available for filtering and sorting

  @integration
  Scenario: Filter by dynamic metadata column
    Given I am on the simulations page in Table View
    And I have enabled the metadata.user_id column
    When I filter metadata.user_id contains test-user
    Then I only see scenarios whose traces have user_id containing test-user
  # ============================================================================
  # Column Visibility Persistence
  # ============================================================================

  @integration
  Scenario: Column visibility persisted in localStorage
    Given I am on the simulations page in Table View
    And I hide the Duration column
    When I refresh the page
    Then the Duration column is still hidden

  @integration
  Scenario: URL column params override localStorage
    Given I have hidden the Duration column in localStorage
    And I have a URL with columns parameter including Duration
    When I navigate to that URL
    Then the Duration column is visible
    And my localStorage preference is not changed

  @integration
  Scenario: Share column visibility via URL
    Given I am on the simulations page in Table View
    And I have customized column visibility
    When I copy the current URL
    And another user navigates to that URL
    Then they see the same column visibility settings
  # ============================================================================
  # URL Parameter Synchronization
  # ============================================================================

  @integration
  Scenario: Load table view with filters from URL
    Given I have a URL with filter parameters:
      | Parameter | Value            |
      | view      | table            |
      | filters   | status eq FAILED |
      | sortBy    | timestamp        |
      | sortOrder | desc             |
    When I navigate to that URL
    Then I see the Table View
    And the status filter shows FAILED
    And the table is sorted by timestamp descending

  @integration
  Scenario: Share filtered view via URL
    Given I am on the simulations page in Table View
    And I have applied filters and sorting
    When I copy the current URL
    And another user navigates to that URL
    Then they see the same filtered and sorted view
  # ============================================================================
  # CSV Export
  # ============================================================================

  @e2e
  Scenario: Export filtered scenarios as CSV
    Given I am on the simulations page in Table View
    And I have applied a status filter for FAILED scenarios
    When I click the Export CSV button
    Then a CSV file is downloaded
    And the CSV contains only the filtered FAILED scenarios

  @integration
  Scenario: Export visible columns only
    Given I am on the simulations page in Table View
    And I have hidden the Duration column
    When I export scenarios as CSV
    Then the CSV does not contain the Duration column
    And the CSV contains all other visible columns

  @integration
  Scenario: Export with expanded trace data
    Given I am on the simulations page in Table View
    When I export scenarios as CSV with Include Traces option
    Then the CSV contains trace-level rows
    And each trace row includes its metadata
  # ============================================================================
  # Pagination
  # ============================================================================

  @integration
  Scenario: Paginate through results
    Given I am on the simulations page in Table View
    And there are more than 20 scenario runs
    When I click on the next page button
    Then I see the next set of scenario runs
    And the page parameter in the URL is updated

  @integration
  Scenario: Change page size
    Given I am on the simulations page in Table View
    When I change the page size to 50
    Then I see up to 50 scenario runs per page
    And the pageSize parameter in the URL is updated
  # ============================================================================
  # Shared Controls
  # ============================================================================

  @integration
  Scenario: Shared controls visible on both views
    Given I am on the simulations page in Grid View
    Then I see the filter and export controls
    When I switch to Table View
    Then I see the same filter and export controls
    And filters applied in one view persist in the other
  # ============================================================================
  # Suite Execution Time
  # ============================================================================

  @integration
  Scenario: Display total execution time for a batch run
    Given I am on the simulations page in Table View
    And I have filtered to a specific batch run
    Then I see the total execution time for the batch
    And the time is calculated as the sum of all scenario durations
  # ============================================================================
  # Error Handling
  # ============================================================================

  @integration
  Scenario: Handle empty results gracefully
    Given I am on the simulations page in Table View
    And I apply filters that match no scenarios
    Then I see an empty state message
    And the message suggests adjusting filters

  @integration
  Scenario: Handle API errors gracefully
    Given I am on the simulations page in Table View
    When the API returns an error
    Then I see an error message
    And I can retry the request
