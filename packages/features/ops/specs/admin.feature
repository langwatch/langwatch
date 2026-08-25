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
