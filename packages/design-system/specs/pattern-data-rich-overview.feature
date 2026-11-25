Feature: Data-rich overview pattern
  As someone building a monitoring or usage page
  I want one runnable example that leads from a trend to the records behind it
  So that I copy figures, a chart and a table that already work together, in light and dark

  @integration
  Scenario: Every overview story shows its state in light and dark
    Given the named stories of the Data-rich overview pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own figures, chart, table, message or banner

  @integration
  Scenario: The figures, the chart and its summary agree
    Given the overview of a week
    Then the requests figure is the sum of the daily requests
    And the chart's description names the busiest and quietest day of that week

  @integration
  Scenario: A metric tab changes the chart only when activated
    Given the overview showing requests
    When the reader moves to the Cost tab with the arrow key
    Then the chart still shows requests
    When the reader presses Enter
    Then the chart shows cost per day

  @integration
  Scenario: The latency tab explains its headline
    Given the overview showing requests
    When the reader opens the Latency tab
    Then the tab is named "Latency (p95)"
    And its panel says the headline is the average of the daily p95 values and the chart shows each day's p95

  @integration
  Scenario: Two ticked rows are exactly what is exported
    Given the trace table
    When the reader ticks two traces and chooses Export selected
    Then the preview lists only those two traces
    And downloading hands those two traces to the application

  @integration
  Scenario: Ticking and menus do not open the detail
    Given the trace table
    When the reader ticks a row or opens its actions menu
    Then no detail drawer opens
    And choosing View details or the trace name opens it

  @integration
  Scenario: Sorting and paging keep the ticked traces
    Given a trace ticked on the first page
    When the reader sorts by cost and moves to the second page
    Then the selection still counts that one trace
    And it is still ticked when the reader returns to its page

  @integration
  Scenario: A search with no match offers a way out
    Given the trace table
    When the reader searches for text no trace has
    Then the table says so, offers Clear filters and a prompt for a coding agent
    And clearing the filters brings the traces back

  @integration
  Scenario: A failed load can be retried
    Given a trace load that fails once
    When the reader chooses Try again twice
    Then the first retry keeps the error and the second shows the traces

  @integration
  Scenario: A failed refresh keeps the old traces
    Given the trace table
    When a refresh fails
    Then the traces stay and a banner offers Try again
    And retrying removes the banner

  @integration
  Scenario: The status filter and the column picker narrow what is shown
    Given the trace table
    When the reader chooses the Error status and hides the Model column
    Then only failed traces remain and the Model column is gone

  @integration
  Scenario: Inside an overlay the selection bar sits in the toolbar
    Given the overview opened with inline selection
    Then the selection bar is in normal flow and not fixed to the viewport

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
