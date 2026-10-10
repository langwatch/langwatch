@ops @support
Feature: Report intake allowance per caller
  The public report intake allows each caller ten reports an hour. The count lives in Redis so
  every process spends one allowance; a caller past it is refused with a rate-limit response until
  the window closes. Same limit, window and error code as main (specs/support/bug-reports.feature).

  @unit
  Scenario: A caller past the hourly allowance is refused
    Given a caller has sent ten reports within the hour
    When the same caller sends another
    Then it is refused with the "agent_report_rate_limited" error
    And the refused report is not stored

  @unit
  Scenario: Another caller keeps their own allowance
    Given a caller has used up the hourly allowance
    When a different caller sends a report
    Then it is stored

  @unit
  Scenario: A shared count left without a window is given one
    Given a caller's shared count has no expiry
    When the caller sends another report
    Then the shared count expires after the window

  @unit
  Scenario: The allowance holds in this process when the shared count is unreachable
    Given the shared count cannot be reached
    When a caller sends more reports than the allowance
    Then the excess is refused by this process's own count
