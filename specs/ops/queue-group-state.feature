# See dev/docs/best_practices/ops-dashboard.md for the conventions, and
# specs/ops/ops-dashboard-density.feature for the layout contract this
# complements: density decides how much room a row gets, this decides what
# state the row must carry.

Feature: Queue group state visibility
  As an operator scanning the groups table during an incident
  I want every row to say what its group is doing right now
  So that failing and retrying work stands out from work that is merely queued

  Context: every row in the groups table read "Active" while showing zero
  pending jobs and a dash in every other column, and clicking one opened a
  dialog containing nothing but the identifier. The state that mattered —
  failing right now, waiting out a retry backoff, eligible now versus deferred
  into the future — was already in the payload the server returned (the ready
  score is the dispatch-eligibility instant, the attempt counter and last error
  ride along on every group) and none of it reached the screen.

  # ── Row classification ────────────────────────────────────────────────

  @unit
  Scenario: A group waiting out a retry backoff reads as retrying
    Given a group whose last attempt failed
    And whose next attempt is deferred into the future
    When the row is classified
    Then it reads as retrying rather than active
    And it carries the time of the next attempt

  @unit
  Scenario: A group that keeps failing is marked as failing
    Given a group carrying an error from its most recent attempt
    And the group has been retried at least once
    When the row is classified
    Then it is marked as failing

  @unit
  Scenario: A stale error does not mark a healthy group as failing
    Given a group whose only recorded error is old
    And the group has never been retried
    When the row is classified
    Then it is not marked as failing

  @unit
  Scenario: Work due now is distinguished from work deferred into the future
    Given one queued group eligible to dispatch now
    And another queued group deferred into the future
    When the rows are classified
    Then the eligible group reads as due now
    And the deferred group reads as scheduled, carrying its eligibility time

  @unit
  Scenario: Trouble sorts above healthy work
    Given blocked, retrying, due, active, and idle groups in one table
    When the table orders its rows
    Then blocked groups come first
    And retrying groups come before all healthy work

  # ── The detail dialog ─────────────────────────────────────────────────

  @unit
  Scenario: A vanished group is reported, not rendered as an empty dialog
    Given the operator opens a group that has since completed and been cleaned up
    When the detail dialog finishes loading
    Then it says the group no longer exists
    And it does not render an empty body

  @unit
  Scenario: The dialog states the next attempt and the age of the last error
    Given a retrying group with a recorded error
    When the operator opens its detail dialog
    Then the dialog shows the attempt count
    And when the next attempt becomes eligible
    And how long ago the last error was recorded

  # ── The latency tiles ─────────────────────────────────────────────────

  @unit
  Scenario: The latency tiles state their sample basis
    Given the dashboard shows P50 and P99 processing-time tiles
    When the tiles render
    Then each states it is measured over the recent completed-jobs sample
    And that the sample is not a time window
