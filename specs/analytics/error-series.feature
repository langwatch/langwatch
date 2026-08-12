Feature: Per-series filters and percentage mode on analytics graphs
  As a platform user
  I want each series of a graph to honour its own filters
  So that a "with errors" series and a "without errors" series show different data

  A custom graph can give every series its own filter set — the canonical case
  being one series filtered to traces with an error and a second filtered to
  traces without one. Each series can additionally be shown as a percentage of
  the same measurement taken without that series' own filters.

  Until this change the per-series filters never reached the executed query, so
  both series returned the identical unfiltered number and the percentage
  toggle changed nothing. Every alert built on a filtered series therefore
  watched the wrong measurement.

  Background:
    Given a project with traces, some of which contain an error

  @integration
  Scenario: The with-errors and without-errors series partition the window
    Given a graph counting traces, with one series filtered to traces with an error and one to traces without
    When the graph is queried over a window
    Then the two series report different counts
    And their counts add up to the count of every trace in the window

  @integration
  Scenario: Percentage mode divides the filtered series by the unfiltered series
    Given a graph counting traces, with one series filtered to traces with an error
    When the series is shown as a percentage
    Then the series reports the share of traces in the window that contain an error

  @integration
  Scenario: Percentage mode reports zero when the window holds no traces
    Given a graph counting traces, with one series filtered to traces with an error and shown as a percentage
    When the graph is queried over a window with no traces
    Then the series reports zero rather than no value at all

  @integration
  Scenario: An alert on the error series counts only traces with errors
    Given a graph whose only series is filtered to traces with an error
    When the graph is queried over a window
    Then the reported value counts only the traces that contain an error

  @integration
  Scenario: A filter that reads span data still applies to its own series only
    Given a graph with one series filtered by span type and one series unfiltered
    When the graph is queried over a window
    Then only the filtered series is narrowed to traces holding a matching span

  @integration
  Scenario: A per-series filter narrows its series on a grouped graph
    Given a graph counting traces grouped by span type, with one filtered series and one unfiltered
    When the graph is queried over a window
    Then every group reports the filtered count for one series and the whole count for the other

  @integration
  Scenario: A per-series filter narrows its series alongside an evaluation measurement
    Given a graph pairing an evaluation score with a trace count filtered to traces with an error
    When the graph is queried over a window
    Then the trace count covers only traces with an error and the score is unaffected

  @integration
  Scenario: A filtered average or extremum reports no value when nothing matched
    Given a graph reporting the shortest trace duration, filtered to something no trace matches
    When the graph is queried over a window that does hold traces
    Then the series reports no value rather than a duration of zero

  @unit
  Scenario: An alert on a series the query refuses is skipped, not retried forever
    Given an alert watching a series that cannot be shown as a percentage
    When the alert is evaluated
    Then the evaluation is skipped instead of failing, so other alerts keep running

  @integration
  Scenario: Grouping by error status puts each trace in exactly one bucket
    Given a graph counting traces grouped by whether the trace contains an error
    When the graph is queried over a window
    Then each trace appears in exactly one of the two buckets
    And the buckets add up to the count of every trace in the window

  @unit
  Scenario: Two series that differ only by their filters produce different queries
    Given a graph with the same measurement twice, filtered to traces with and without an error
    When the query is built
    Then the two series compile to different expressions

  @unit
  Scenario: Percentage mode on an unfiltered series leaves the series unchanged
    Given a graph with a single unfiltered series shown as a percentage
    When the query is built
    Then the series is measured exactly as it would be without percentage mode

  @unit
  Scenario: A percentage on a per-entity average is refused rather than answered wrongly
    Given a graph whose series averages per user and is both filtered and shown as a percentage
    When the query is built
    Then building the query fails and names the unsupported combination
