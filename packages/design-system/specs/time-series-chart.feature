Feature: Time series chart
  As someone building a monitoring screen
  I want one chart for a value over days that draws the product's grid, colour and hover reading
  So that every trend looks the same and reads aloud what it shows

  @integration
  Scenario: The chart is named and described from its points
    Given a series of seven daily readings
    When the chart is drawn
    Then it is a figure named by its label
    And its description gives the first and last moment, the highest, the lowest and the latest reading

  @integration
  Scenario: Several series are told apart by a legend
    Given two series sharing the same days
    When the chart is drawn
    Then each series has its own line and the legend names both
    And a single series shows no legend

  @integration
  Scenario: Hovering reads the nearest moment
    Given a drawn chart
    When the pointer rests over the third day
    Then a reading shows that day, the series name and its value in the formatted unit

  @integration
  Scenario: A chart with no points keeps its box and says so
    Given a series with no points
    When the chart is drawn
    Then it shows "No data for this period" and the sentence it was given
    And it draws no figure

  @integration
  Scenario: One series is orange and several take the chart palette in order
    Given one series and then two
    When the chart is drawn each time
    Then the lone series is drawn in the product orange
    And two series are drawn in the first two chart colours
