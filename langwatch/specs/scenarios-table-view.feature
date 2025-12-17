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
  # ============================================================================
  # Integration: Type-Aware Filtering
  # ============================================================================

  @integration
  Scenario: Text column shows contains and not-contains operators
    Given I am on the simulations page in Table View
    When I open the Name column filter
    Then I see "contains" and "not contains" operators

  @integration
  Scenario: Number column shows numeric comparison operators
    Given I am on the simulations page in Table View
    When I open a numeric column filter
    Then I see operators: greater than, less than, equals, at least, at most

  @integration
  Scenario: Duration column shows time preset filters
    Given I am on the simulations page in Table View
    When I open the Duration column filter
    Then I see presets: under 5m, under 30m, under 1h, under 3h, under 1d
    And I can set a custom time range

  @integration
  Scenario: Enum column allows multi-select filtering
    Given I am on the simulations page in Table View
    When I open the Status column filter
    And I select FAILED and ERROR
    Then I see scenarios with either FAILED or ERROR status
  # ============================================================================
  # Integration: Column Operations
  # ============================================================================

  @integration
  Scenario: Group rows by column value
    Given I am on the simulations page in Table View
    When I group by Status
    Then rows are organized under status group headers
    And each header shows the count for that status

  @integration
  Scenario: Pin column to left side
    Given I am on the simulations page in Table View
    When I pin the Name column to the left
    Then Name stays visible when scrolling horizontally

  @integration
  Scenario: Dynamic metadata columns from traces
    Given scenarios have traces with metadata fields user_id and session_id
    When I am on the simulations page in Table View
    Then column visibility shows metadata.user_id and metadata.session_id
    And I can enable and filter by these columns
  # ============================================================================
  # Integration: State Persistence
  # ============================================================================

  @integration
  Scenario: Column visibility persists in localStorage
    Given I am on the simulations page in Table View
    And I hide the Duration column
    When I refresh the page
    Then the Duration column remains hidden

  @integration
  Scenario: URL parameters override localStorage preferences
    Given I have Duration hidden in localStorage
    And I have a URL with Duration visible in the columns parameter
    When I navigate to that URL
    Then the Duration column is visible

  @integration
  Scenario: Invalid URL parameters are ignored gracefully
    Given I have a URL with malformed filter parameters
    When I navigate to that URL
    Then I see the Table View without errors
    And invalid filters are not applied
  # ============================================================================
  # Integration: Error Handling
  # ============================================================================

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
  # Unit Tests (implemented in *.unit.test.ts)
  # ============================================================================
  # - Filter parser: converts URL string to filter objects
  # - Filter evaluator: applies filter to row, returns boolean
  # - Time range parser: converts "<5m" to milliseconds
  # - CSV generator: converts rows to CSV string
  # - URL param serializer: bidirectional filter <-> URL conversion
