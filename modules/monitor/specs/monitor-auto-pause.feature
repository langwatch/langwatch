Feature: A monitor whose evaluations mostly fail pauses itself
  Evaluation records that a monitor's error rate was exceeded as its own fact
  (modules/evaluation/specs/monitor-error-rate.feature). Monitor reacts from its own side:
  it disables the monitor, records why and when on the monitor row, and emails the
  organization's admins once. Evaluation holds no write on the monitor table (ARCHITECTURE.md §9).

  @unit
  Scenario: A monitor is paused when its error rate is exceeded
    Given an enabled on-message monitor at revision R
    When evaluation reports that its error rate was exceeded at revision R
    Then the monitor is disabled
    And the monitor records when it was paused and a reason naming the failure rate and the most common error

  @unit
  Scenario: A report about an older revision of the monitor is ignored
    Given a monitor that was edited after revision R
    When evaluation reports that its error rate was exceeded at revision R
    Then the monitor stays enabled and records no reason

  @unit
  Scenario: The organization's admins are emailed once
    Given an enabled on-message monitor at revision R in a project whose organization has two active admins
    When the same error rate fact is delivered twice
    Then each admin is sent one email naming the monitor, the failure rate, the most common error and a link to the monitor
    And the second delivery sends no email

  @unit
  Scenario: A failed email leaves the monitor paused
    Given an enabled on-message monitor at revision R whose admins cannot be emailed
    When evaluation reports that its error rate was exceeded at revision R
    Then the monitor is paused and the failure is logged, not retried

  @unit
  Scenario: Re-enabling a paused monitor clears the reason
    Given a monitor that paused itself
    When the user enables it again
    Then the monitor no longer records a pause reason or time

  @integration
  Scenario: The pause reason is stored on the monitor row
    Given a monitor row in Postgres at revision R
    When the monitor pauses itself at revision R
    Then the row reads back disabled with its pause time and reason
    And a second pause at the same revision changes nothing

  @integration
  Scenario: The REST API shows why a monitor paused itself
    Given a monitor that paused itself
    When the monitor is read through the REST API
    Then the response carries autoPausedAt and autoPausedReason

  @integration
  Scenario: The monitor list shows that a monitor paused itself
    Given a monitor that paused itself
    When the online evaluations list renders
    Then its row shows a "Paused automatically" badge whose tooltip carries the reason
