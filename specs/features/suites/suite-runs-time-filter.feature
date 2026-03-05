Feature: Time filter for suite runs
  As a user viewing the Suites page
  I want to filter suite runs by time range
  So that I can focus on relevant runs without scrolling through old data

  Background:
    Given a project with suite runs spanning multiple days

  @e2e
  Scenario: User filters All Runs by a preset time range
    Given the All Runs panel is open with runs from the past 90 days
    When I select "Last 7 days" from the time filter
    Then only runs from the last 7 days are displayed

  @e2e
  Scenario: Time filter updates displayed runs when period changes
    Given the All Runs panel is open
    When the selected period changes
    Then only runs within that time window are returned

  @integration
  Scenario: Suite detail panel filters runs by selected time range
    Given a suite with runs spanning 30 days
    When the time filter is set to the last 7 days
    Then the suite's run history only shows runs from the last 7 days

  @integration
  Scenario: Changing the time filter resets pagination
    Given the user has loaded multiple pages of runs
    When the time filter is changed to a different range
    Then pagination resets to the first page
    And only the first page of filtered results is shown

  @unit
  Scenario: Selected date range limits displayed run data
    Given a date range is selected
    When run data is requested
    Then only runs within the selected date range are shown
    And runs outside the selected date range are not shown

  @integration
  Scenario: Batch runs are included or excluded atomically
    Given a batch run with individual runs spanning a time boundary
    When the time filter range excludes the batch's earliest runs but includes the latest
    Then the entire batch is shown

  @unit
  Scenario: Default time range is applied on initial load
    Given no time range has been selected
    When the suites page loads
    Then the time filter defaults to the last 30 days
