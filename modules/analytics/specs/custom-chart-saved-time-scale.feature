Feature: The chart builder saves its time scale as the shape the query schema accepts
  The builder's time scale is a native select, which hands its value back as text. A chart
  saved with "60" instead of 60 renders (the screen coerces before it queries) but every
  other reader of the saved chart, a graph alert among them, is refused by the timeseries
  input schema. The saved chart carries a number of minutes, or "full".

  @unit
  Scenario: A chart saved with a bucket size stores it as a number of minutes
    Given the author picked "1 hour" as the chart's time scale
    When the chart is turned into the input it is saved as
    Then the saved time scale is the number 60

  @unit
  Scenario: A chart saved over the full period stores the full period
    Given the author picked "Full period" as the chart's time scale
    When the chart is turned into the input it is saved as
    Then the saved time scale is "full"
