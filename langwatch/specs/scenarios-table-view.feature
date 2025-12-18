@wip
Feature: Scenarios Table View
  As a LangWatch user
  I want to view scenario execution results in a table format
  So that I can filter, sort, and analyze scenario data efficiently
  # ===========================================================================
  # TESTING STRATEGY
  # ===========================================================================
  #
  # Architecture layers:
  #   Frontend Hooks → tRPC Router (thin) → ScenarioEventService → Database
  #
  # Test boundaries:
  #   - E2E: Full browser tests for happy paths (minimal, 3-4 scenarios)
  #   - Integration: ScenarioEventService → Elasticsearch (one test per capability)
  #   - Unit: Pure logic (filter builders, parsers, serializers)
  #
  # Integration test philosophy:
  #   The repository builds ES queries. Integration tests verify the query
  #   builder produces correct results against a real DB. We test:
  #   - ONE filter (proves filter→query works)
  #   - ONE sort (proves sort→query works)
  #   - ONE pagination (proves offset/limit works)
  #   - Empty results (boundary case)
  #
  #   Filter operator variations (eq, contains, between) are unit tested on
  #   the query builder function - no DB roundtrip needed for permutations.
  #
  # Implementation files:
  #   - scenario-event.service.integration.test.ts
  #   - scenario-event.repository.unit.test.ts (query builder)
  #
  # ===========================================================================

  Background:
    Given I am logged in as a user with scenarios:view permission
    And I have a project with scenario execution data
  # ===========================================================================
  # E2E: Happy Paths (browser tests, minimal coverage)
  # ===========================================================================

  @e2e
  Scenario: View scenarios in table format
    Given I am on the simulations page
    When I click the Table View tab
    Then I see scenario runs displayed in rows
    And columns include Name, Status, Duration, Timestamp

  @e2e
  Scenario: Filter and sort scenarios
    Given I am on the simulations page in Table View
    When I filter Status to FAILED
    And I sort by Timestamp descending
    Then I see only FAILED scenarios sorted by most recent first

  @e2e
  Scenario: Export filtered scenarios as CSV
    Given I am on the simulations page in Table View
    And I have filtered to FAILED scenarios
    When I click Export CSV
    Then a CSV downloads containing only FAILED scenarios

  @e2e @out-of-scope
  Scenario: Expand row to view trace details
    Given I am on the simulations page in Table View
    When I expand a scenario row
    Then I see a nested table with trace data
  # ===========================================================================
  # Integration: Service Layer → Database (one test per capability)
  # ===========================================================================
  # These verify ScenarioEventService.getFilteredScenarioRuns() works end-to-end.
  # We test each capability ONCE to prove query building works correctly.
  # Filter operator variations are unit tested on the query builder.

  @integration
  Scenario: Filter scenarios returns matching records
    Given scenarios exist with statuses PASSED, FAILED, ERROR
    When I call getFilteredScenarioRuns with filter status eq FAILED
    Then only scenarios with status FAILED are returned

  @integration
  Scenario: Sort scenarios returns ordered results
    Given scenarios exist with timestamps 10am, 11am, 12pm
    When I call getFilteredScenarioRuns with sorting timestamp desc
    Then scenarios are returned in order 12pm, 11am, 10am

  @integration
  Scenario: Paginate scenarios returns correct page
    Given 50 scenarios exist
    When I call getFilteredScenarioRuns with page 2 and pageSize 20
    Then scenarios 21-40 are returned
    And total count is 50

  @integration
  Scenario: Empty filter results returns empty array
    Given no scenarios match the filter criteria
    When I call getFilteredScenarioRuns with status eq NONEXISTENT
    Then an empty array is returned with total count 0

  @integration
  Scenario: Combined filter, sort, and pagination work together
    Given 30 scenarios exist with mixed statuses and timestamps
    When I call getFilteredScenarioRuns with filter status eq FAILED, sorting timestamp desc, page 1, pageSize 10
    Then only FAILED scenarios are returned
    And they are sorted by timestamp descending
    And at most 10 results are returned

  # ===========================================================================
  # Integration: Repository Edge Cases
  # ===========================================================================
  # These test complex repository logic that isn't covered by service tests.
  # The repository has branching logic for status filtering and cross-index search.

  @integration
  Scenario: Filter by IN_PROGRESS status finds runs without finished event
    Given a scenario run started but not finished
    And a scenario run that finished with SUCCESS
    When I call searchScenarioRuns with filter status eq IN_PROGRESS
    Then only the unfinished run is returned

  @integration
  Scenario: Filter by finished status queries RUN_FINISHED events directly
    Given scenarios with statuses SUCCESS, FAILED, ERROR
    When I call searchScenarioRuns with filter status eq SUCCESS
    Then only SUCCESS runs are returned
    And the query targets RUN_FINISHED events

  @integration
  Scenario: Global search includes trace metadata matches
    Given a scenario run with trace containing metadata user_id test-user
    When I call searchScenarioRuns with search test-user
    Then the scenario run is returned via trace metadata match
  # ===========================================================================
  # Unit: Query Builder (filter operator variations)
  # ===========================================================================
  # These test the ES query builder function directly without DB calls.
  # Covers all operator permutations cheaply.

  @unit
  Scenario: Build query with eq operator
    Given filter columnId status, operator eq, value FAILED
    When I build the ES query
    Then query contains term match for status FAILED

  @unit
  Scenario: Build query with contains operator
    Given filter columnId name, operator contains, value login
    When I build the ES query
    Then query contains wildcard match for name *login*

  @unit
  Scenario: Build query with between operator for timestamps
    Given filter columnId timestamp, operator between, value [startMs, endMs]
    When I build the ES query
    Then query contains range clause for timestamp

  @unit
  Scenario: Build query with sorting
    Given sorting columnId timestamp, order desc
    When I build the ES query
    Then query contains sort clause for timestamp descending
  # ===========================================================================
  # Unit: Pure Logic (parsers, serializers)
  # ===========================================================================

  @unit
  Scenario: Parse filter from URL parameters
    Given a URL with filter parameter status=eq:FAILED
    When I parse the filter
    Then I get a filter object with columnId status, operator eq, value FAILED

  @unit
  Scenario: Serialize filter to URL parameters
    Given a filter object with columnId status, operator eq, value FAILED
    When I serialize to URL
    Then I get parameter string status=eq:FAILED

  @unit
  Scenario: Generate CSV from scenario rows
    Given scenario rows with columns name, status, timestamp
    When I generate CSV
    Then I get valid CSV string with headers and data rows

  @unit
  Scenario: Invalid URL parameters are ignored gracefully
    Given a URL with malformed filter parameters
    When I parse state from URL
    Then no errors are thrown
    And invalid filters are not applied
