Feature: Platform administration package boundary
  Platform-admin access and impersonation are explicitly composed.

  @unit
  Scenario: Admin email matching is normalized
    Given an allow-list with mixed case, spaces, and blanks
    When platform-admin access checks an email
    Then matching is case-insensitive and blanks are ignored

  @unit
  Scenario: An admin cannot impersonate another admin
    Given the target email is in the platform-admin allow-list
    When an admin starts impersonation
    Then the service reports cannot_impersonate_admin without changing session state

  @unit
  Scenario: A healthy target receives a bounded session window
    Given a healthy non-admin target
    When an admin starts impersonation with a reason
    Then the attempt is audited and the session window expires after one hour

  @unit
  Scenario: Blob listing reports sampled ordering honestly
    Given an operator requests a ranked blob listing
    When Redis returns a bounded sample
    Then the result reports the sample size and rankedFromSample

  @unit
  Scenario: Blob deletion refuses a live lease atomically
    Given a blob still has a live lease
    When an operator requests deletion
    Then the bytes remain and the result reports deleted as false

  @integration
  Scenario: The Ops dashboard stream starts with the current snapshot
    Given a readable current Ops snapshot
    When an authorized subscriber opens the dashboard stream
    Then the current snapshot is delivered before waiting for the next update
    And every dashboard response field remains present

  @unit
  Scenario: A manual scheduler run follows the ordinary due path
    Given an active schedule with no claimed slot
    When an operator requests an immediate run
    Then the schedule is made due rather than invoking its target directly
    And the scheduler is woken after the audited control

  @unit
  Scenario: Scheduler controls refuse stale or racing state
    Given a paused schedule or a live or non-stale claimed slot
    When an operator requests a conflicting control
    Then the service refuses with its stable scheduler error
    And no audit entry is written for the refused control
