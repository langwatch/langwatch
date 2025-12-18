@wip
Feature: Scenarios Table View
  As a LangWatch user
  I want to view scenario execution results in a table format
  So that I can filter, sort, and analyze scenario data efficiently

  Background:
    Given I am logged in as a user with scenarios:view permission
    And I have a project with scenario execution data
  # ============================================================================
  # E2E: Happy Paths
  # ============================================================================

  @e2e
  Scenario: View scenarios in table format
    Given I am on the simulations page
    When I click the Table View tab
    Then I see scenario runs displayed in rows
    And columns include Name, Status, Duration, Timestamp

  @e2e
  Scenario: Navigate to scenario set via linked ID
    Given I am on the simulations page in Table View
    When I click a scenario set ID link
    Then I am on the scenario set detail page

  @e2e
  Scenario: Filter scenarios by status
    Given I am on the simulations page in Table View
    When I filter Status to FAILED
    Then I see only scenarios with FAILED status

  @e2e
  Scenario: Search scenarios globally
    Given I am on the simulations page in Table View
    When I search for "login error"
    Then I see scenarios matching "login error" in name or content

  @e2e
  Scenario: Sort and paginate results
    Given I am on the simulations page in Table View
    And there are more than 20 scenario runs
    When I sort by Timestamp descending
    And I navigate to page 2
    Then I see the next set of older scenarios

  @e2e
  Scenario: Export filtered scenarios as CSV
    Given I am on the simulations page in Table View
    And I have filtered to FAILED scenarios
    When I click Export CSV
    Then a CSV downloads containing only FAILED scenarios

  @e2e
  Scenario: Expand row to view trace details
    Given I am on the simulations page in Table View
    When I expand a scenario row
    Then I see a nested table with trace data
    And columns include Trace ID, Timestamp, Input, Output, Tokens, Cost

  @e2e
  Scenario: Click trace to open details drawer
    Given I am on the simulations page in Table View
    And I have expanded a scenario row
    When I click on a trace row
    Then the trace details drawer opens
    And I see the full trace timeline and spans

  @e2e
  Scenario: Open run details via actions column
    Given I am on the simulations page in Table View
    When I click the actions button on a scenario row
    Then I am navigated to the run details page

  @e2e
  Scenario: Customize columns and share view via URL
    Given I am on the simulations page in Table View
    When I hide the Duration column
    And I show the metadata.user_id column
    And I copy the current URL
    Then navigating to that URL shows the same column configuration

  @e2e @out-of-scope
  Scenario: Multi-column sorting
    Given I am on the simulations page in Table View
    When I sort by Status ascending then by Timestamp descending
    Then scenarios are sorted by Status first, then by Timestamp within each status

  @e2e
  Scenario: Clear all filters
    Given I am on the simulations page in Table View
    And I have multiple filters applied
    When I click Clear All Filters
    Then all filters are removed
    And I see all scenarios
  # ============================================================================
  # Integration: Error Handling & Dynamic Data
  # ============================================================================

  @integration
  Scenario: Dynamic metadata columns from traces
    Given scenarios have traces with metadata fields user_id and session_id
    When I am on the simulations page in Table View
    Then column visibility shows metadata.user_id and metadata.session_id
    And I can enable and filter by these columns

  @integration
  Scenario: Empty filter results show helpful message
    Given I am on the simulations page in Table View
    When I apply filters matching no scenarios
    Then I see an empty state with a message to adjust filters

  @integration
  Scenario: API errors show retry option
    Given I am on the simulations page in Table View
    When the scenarios API returns an error
    Then I see an error message
    And I can click Retry to reload
  # ============================================================================
  # Unit: Type-Aware Filtering (pure rendering logic)
  # ============================================================================

  @unit
  Scenario: Text column shows contains and not-contains operators
    Given a text column type
    When I render the filter UI
    Then I see "contains" and "not contains" operators

  @unit
  Scenario: Number column shows numeric comparison operators
    Given a number column type
    When I render the filter UI
    Then I see operators: greater than, less than, equals, at least, at most

  @unit
  Scenario: Date column shows time preset filters
    Given a date column type
    When I render the filter UI
    Then I see presets: under 5m, under 30m, under 1h, under 3h, under 1d
    And I can set a custom time range

  @unit
  Scenario: Enum column allows multi-select filtering
    Given an enum column type with values FAILED and ERROR
    When I render the filter UI
    Then I can select multiple values
  # ============================================================================
  # Unit: Column Operations (pure client-side UI)
  # ============================================================================

  @unit
  Scenario: Group rows by column value
    Given scenario rows with mixed Status values
    When I group by Status
    Then rows are organized under status group headers
    And each header shows the count for that status

  @unit @out-of-scope
  Scenario: Column reordering via drag and drop
    Given a list of columns in order [Name, Status, Duration]
    When I reorder Status before Name
    Then columns are [Status, Name, Duration]

  @unit @out-of-scope
  Scenario: Pin column to left side
    Given a column configuration
    When I pin the Name column
    Then Name is marked as pinned in state
  # ============================================================================
  # Unit: State Persistence (pure client logic)
  # ============================================================================

  @unit
  Scenario: Column visibility persists in localStorage
    Given column visibility state
    When I hide the Duration column and reload
    Then the Duration column remains hidden in restored state

  @unit
  Scenario: URL parameters override localStorage preferences
    Given Duration hidden in localStorage
    And a URL with Duration visible in the columns parameter
    When I parse state from URL
    Then the Duration column is visible

  @unit
  Scenario: Invalid URL parameters are ignored gracefully
    Given a URL with malformed filter parameters
    When I parse state from URL
    Then no errors are thrown
    And invalid filters are not applied
  # ============================================================================
  # Unit Tests (implemented in *.unit.test.ts)
  # ============================================================================
  # - Filter parser: converts URL string to filter objects
  # - Filter evaluator: applies filter to row, returns boolean
  # - Time range parser: converts "<5m" to milliseconds
  # - CSV generator: converts rows to CSV string
  # - URL param serializer: bidirectional filter <-> URL conversion
