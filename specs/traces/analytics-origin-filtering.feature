Feature: Analytics dashboard filters by trace origin
  The analytics dashboard shows only application traces by default,
  excluding scenario runs, evaluation runs, and playground traces from
  the summary cards, timeseries graphs, and percentage comparisons.

  Background:
    Given a project with traces from multiple origins:
      | origin      | count |
      | application | 5000  |
      | simulation  | 80000 |
      | evaluation  | 2000  |
      | playground  | 65    |
    And traces created before March 7 have empty origin attribute

  @integration
  Scenario: Analytics summary cards show only application traces
    When I visit the analytics overview page
    Then the "Traces" summary card shows 5000
    And the "Threads" summary card counts only application threads
    And the "Users" summary card counts only application users

  @integration
  Scenario: Analytics timeseries graph shows only application traces
    When I visit the analytics overview page
    Then the traces line chart plots only application trace counts per day
    And the "Previous Traces" comparison line uses the same origin filter

  @integration
  Scenario: Percentage change reflects application traffic only
    Given the previous period had 4500 application traces
    And the previous period had 60000 simulation traces
    When I visit the analytics overview page
    Then the percentage change for Traces shows approximately 11%
    And it does not show 2600% from mixed origin comparison

  @unit
  Scenario: Pre-March 7 traces with empty origin are treated as application
    Given traces before March 7 have no langwatch.origin attribute
    When the origin filter is set to application
    Then traces with empty origin are included in the count
    And only traces with explicit non-application origin are excluded

  @integration
  Scenario: User can override origin filter via filter sidebar
    When I visit the analytics overview page
    And I open the filter sidebar
    And I select "All" for the traces origin filter
    Then the summary cards and graph include all trace origins
