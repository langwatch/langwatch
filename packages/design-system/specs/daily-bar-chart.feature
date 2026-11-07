Feature: Daily bar chart
  As someone building a screen that counts something per day
  I want one bar per day drawn against the busiest day
  So that a month reads at a glance and every daily count looks the same

  @integration
  Scenario: Each day is drawn against the busiest day
    Given three days counting 100, 1 and 0
    When the chart is drawn
    Then the busiest day fills the chart
    And the small day keeps a visible sliver
    And the empty day draws no bar

  @integration
  Scenario: Hovering a bar names its day and the axis labels the month
    Given a chart of a month of days with axis labels
    When it is drawn
    Then each bar carries its day's title for hover
    And the axis labels sit under the bars
    And a screen reader hears the summary in place of the bars
