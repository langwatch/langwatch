Feature: Data from the browser's saved copy is never shown as current
  As a reader opening a page that draws from the browser's saved copy
  I want old numbers shown as unconfirmed until the network confirms them
  So that I never mistake a saved figure for a current one

  @integration
  Scenario: Saved data is dimmed and says when it is from
    Given data drawn from the browser's saved copy, fetched at 10:42 today
    When the network has not yet confirmed it
    Then the data is shown dimmed and marked busy
    And a note says "Showing data from 10:42 · updating" with a spinner

  @integration
  Scenario: Confirmed data is shown at full strength
    Given data drawn from the browser's saved copy
    When the network confirms it
    Then the data is shown at full strength
    And no note is shown

  @integration
  Scenario: A refresh that did not answer says it could not refresh
    Given saved data fetched at 10:42 today that the network has not confirmed
    When the refresh has failed
    Then the data stays dimmed
    And the note says "From 10:42 · couldn't refresh" with no spinner

  @integration
  Scenario: A copy from an earlier day names the day
    Given saved data fetched at 10:42 on an earlier day
    When the network has not yet confirmed it
    Then the note names the day as well as the time
