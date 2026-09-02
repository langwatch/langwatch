Feature: The analytics pages

  The nine analytics addresses are served from `@langwatch/analytics-web`
  rather than from `platform/app`. What a reader can reach, which screen each
  address is, and what the charts draw from what the server returned are the
  properties this file states — the ones a move can break silently, where a
  wrong chart looks exactly like a right one.

  # ---------------------------------------------------------------------------
  # Who can reach a chart
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every analytics address is behind the analytics view grant
    Given a member who holds the analytics view grant
    When they open any of the nine analytics addresses
    Then each address opens its own screen

  @integration
  Scenario: A reader without the analytics grant reaches no analytics page
    Given a member who holds a neighbouring grant but not analytics view
    When they open any of the nine analytics addresses directly
    Then each address refuses them and names the grant it needs

  @integration
  Scenario: The chart builder is told which of its two addresses it is
    Given the chart builder serves both the create and the edit address
    When each address is opened
    Then the create address opens an empty builder
    And the edit address opens the builder on the stored chart

  # ---------------------------------------------------------------------------
  # The range every chart is drawn over
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An address naming no range falls back to the last thirty days
    Given an address carrying neither a range nor a preset
    When the window is read
    Then the last thirty days are shown
    And the page reports that the reader did not pick that window

  @unit
  Scenario: A range and a preset are the same setting, so one replaces the other
    Given an address carrying an absolute range
    When the reader picks a relative preset instead
    Then the address names the preset
    And the absolute range is removed from the address

  @unit
  Scenario: A backwards range is ordered rather than queried
    Given a reader who enters an end instant before the start instant
    When the range is written to the address
    Then the two instants are ordered so the window is never negative

  @unit
  Scenario: A relative window does not move between renders
    Given a page showing a relative window
    When the page renders again without the address changing
    Then it is drawn over the very same window
    And no further read is sent

  # ---------------------------------------------------------------------------
  # What the filters narrow
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every filter field the platform offers is still offered
    Given the list of filter fields the analytics contract enumerates
    When the filter rail is built
    Then every field has a name and a query-string key of its own

  @unit
  Scenario: A filter the reader emptied stops narrowing the charts
    Given a filter whose values have all been removed
    When the charts are read
    Then that filter is not sent

  @unit
  Scenario: A filter whose values are still being chosen is kept
    Given a filter whose key is picked and whose values are still loading
    When the charts are read
    Then the filter is kept so the nested picker stays open

  @unit
  Scenario: Clearing the filters leaves the page's own parameters alone
    Given an address carrying filters, a range and a dashboard
    When the reader clears the filters
    Then only the filter parameters are removed

  # ---------------------------------------------------------------------------
  # What the charts draw
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A leaderboard leaves the unknown grouping bucket out
    Given a grouped result carrying an unknown bucket
    And a chart that asks for unknown buckets to be excluded
    When the chart renders
    Then the named group is plotted
    And the unknown bucket is not

  @integration
  Scenario: A chart that could not be read says so instead of drawing nothing
    Given a timeseries read the server refused
    When the chart renders
    Then it names the action that failed and offers a retry
    And it never shows the error code slug

  # ---------------------------------------------------------------------------
  # Opening a trace from a chart
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Opening a trace from the feedback table writes the overlay address
    Given a feedback row on the users page
    When the reader opens the trace behind it
    Then the address names the trace overlay and the trace
    And the page's range and filters stay on the address

  @unit
  Scenario: Opening a second overlay clears the first one's parameters
    Given an address already carrying another overlay's parameters
    When a trace is opened
    Then every parameter the previous overlay left behind is removed
