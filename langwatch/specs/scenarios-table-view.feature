Feature: Scenarios Table View
  As a LangWatch user
  I want to view scenario execution results in a table format
  So that I can filter, sort, and analyze scenario data efficiently

  # ===========================================================================
  # IMPLEMENTATION NOTES
  # ===========================================================================
  # Filtering, sorting, pagination, grouping handled CLIENT-SIDE via TanStack React Table.
  #
  # Implementation:
  #   - langwatch/src/components/simulations/table-view/ScenariosTableView.tsx
  #   - langwatch/src/components/simulations/table-view/scenarioColumns.tsx
  #   - langwatch/src/features/simulations/hooks/useExportScenarioRuns.ts
  # ===========================================================================

  Background:
    Given I am logged in as a user with scenarios:view permission
    And I have a project with scenario execution data

  # ===========================================================================
  # E2E: Happy Paths
  # ===========================================================================
  # Test file: langwatch/e2e/happy-paths/scenarios-table-view.spec.ts

  @e2e @todo
  Scenario: View scenarios in table format
    Given I am on the simulations page
    When I click the Table View tab
    Then I see scenario runs displayed in rows
    And columns include Name, Status, Duration, Timestamp

  @e2e @todo
  Scenario: Filter and sort scenarios
    Given I am on the simulations page in Table View
    When I filter Status to FAILED
    And I sort by Timestamp descending
    Then I see only FAILED scenarios sorted by most recent first

  @e2e @todo
  Scenario: Export scenarios as CSV
    Given I am on the simulations page in Table View
    When I click Export CSV
    Then a CSV downloads containing scenario data with visible columns
