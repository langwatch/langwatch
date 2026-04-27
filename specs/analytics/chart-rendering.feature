Feature: Analytics Chart Rendering

  Charts on the analytics dashboard render data correctly across
  all graph types, metrics, and color configurations.

  Background:
    Given a project with analytics data stored in ClickHouse

  # ---------------------------------------------------------------------------
  # Graph type switching
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Switching from monitor graph to bar chart preserves sparse pass rate data
    Given a project with sparse evaluation pass rate data
    When the user views the data as a monitor graph
    Then the chart displays the pass rate data
    When the user switches to a bar chart
    Then the chart still displays the pass rate data

  # ---------------------------------------------------------------------------
  # Bar chart color alignment
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Bar chart colors align with their data series after sorting
    Given a bar chart with multiple data series sorted by value
    When the chart renders
    Then each bar's color matches its corresponding data series

  # ---------------------------------------------------------------------------
  # Pass rate formatting
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Evaluation pass rate displays as percentage
    Given a chart showing evaluation pass rate data
    When the chart renders the Y-axis and tooltips
    Then values display as percentages like "85%" not decimals like "0.85"

  # ---------------------------------------------------------------------------
  # Semantic color tokens
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Charts using semantic color tokens render visible colors
    Given a chart using the default color set with semantic tokens
    When the chart renders with color adjustments
    Then all bars and lines have valid visible colors

  # ---------------------------------------------------------------------------
  # Filter-driven re-render
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Changing graph filters updates the displayed data
    Given a chart with active filters
    When the user changes the filter criteria
    Then the chart re-renders with the updated filter results

  # ---------------------------------------------------------------------------
  # Current period without comparison
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Chart renders current data without previous period
    Given a chart configured without previous period comparison
    When the timeseries data loads
    Then the chart displays the current period data

  # ---------------------------------------------------------------------------
  # Event metrics coexistence
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Event details and event score metrics use distinct aggregation keys
    Given a dashboard with both event score and event details metrics
    When both metrics query the same event key and subkey
    Then each metric returns its own independent data

  # ---------------------------------------------------------------------------
  # Tokens per second metric completeness
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Tokens per second metric resolves duration from stored spans
    Given an analytics query for the performance tokens per second metric
    When the ClickHouse query is built
    Then the stored spans data includes duration information needed to compute the rate

  # ---------------------------------------------------------------------------
  # Error state when query fails (bug fix #2599)
  # ---------------------------------------------------------------------------

  @regression @integration
  Scenario: Chart shows error state when analytics query fails
    Given an analytics chart with no cached data
    When the ClickHouse query returns an error
    Then the chart displays an error message instead of a blank area
    And a retry button is available
    And the backend error details are accessible via a "Show details" control

  @regression @integration
  Scenario: Chart shows stale-data badge when refetch fails with cached data
    Given an analytics chart with previously loaded data
    When a background refetch fails
    Then the chart continues showing the cached data
    And a badge indicates the data may be stale with a retry option

  @regression @integration
  Scenario: Error state is visually distinct from empty data state
    Given an analytics chart
    When the query fails with an error
    Then the chart shows an error alert with a red indicator
    When there is no data instead of an error
    Then the chart shows a neutral "No data" message without error styling

  @regression @integration
  Scenario: All chart types show "No data" when query returns empty results
    Given an analytics chart of any type including summary, bar, pie, or line
    When the query succeeds but returns no data
    Then the chart shows a "No data" message instead of a blank area
    And the empty chart content is not rendered underneath
