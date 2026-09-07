Feature: Period selector remembers relative ranges as relative

  The period selector lets users pick a time window for dashboards, traces,
  messages, and analytics. When a user picks a relative range like "Last 15
  minutes", that selection must stay relative — the window should re-anchor
  to the current time on every page load, not freeze at the moment of
  clicking. Only when the user picks an absolute range (by entering explicit
  start/end dates) should the window stay fixed.

  Scenario: Picking a relative quick selector stores the selection as relative
    Given the user is on a page with a period selector
    When the user clicks "Last 15 minutes"
    Then the URL contains "period=15m"
    And the URL does not contain "startDate" or "endDate"
    And the period mode is "relative"

  Scenario: A relative selection re-anchors on a later visit
    Given the user previously selected "Last 15 minutes" at 10:00
    When the user returns to the page at 14:30
    Then the period start date is approximately 14:15
    And the period end date is approximately 14:30

  Scenario: Picking explicit dates stores the selection as absolute
    Given the user is on a page with a period selector
    When the user enters a start date of "2026-04-20T00:00" and an end date of "2026-04-22T23:59"
    Then the URL contains "startDate" and "endDate"
    And the URL does not contain "period"
    And the period mode is "absolute"

  Scenario: An absolute selection does not move with time
    Given the user previously selected an absolute range from "2026-04-20" to "2026-04-22"
    When the user returns to the page two days later
    Then the period still starts on "2026-04-20" and ends on "2026-04-22"

  Scenario: Switching from absolute back to a relative quick selector clears absolute params
    Given the URL contains "startDate" and "endDate"
    When the user clicks "Last 7 days"
    Then the URL contains "period=7d"
    And the URL does not contain "startDate" or "endDate"

  Scenario: Unknown or malformed period key falls back to the default
    Given the URL contains "period=bogus"
    When the page loads
    Then the period falls back to the default range
    And the period mode is "relative"

  Scenario: The selector label reflects the current mode
    When the user has selected "Last 15 minutes"
    Then the selector button shows "Last 15 minutes"
    When the user has selected an absolute range
    Then the selector button shows the formatted start and end dates
