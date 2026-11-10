Feature: A saved retention period reaches the data already stored

  Retention is stamped on every stored row when it is written, so a new
  period changes nothing already stored until it is applied. Saving a longer
  period applies it at once, since nothing is deleted. Saving a shorter one
  asks first, naming how many stored traces the new period would delete.
  ClickHouse deletes them on its next TTL merge, so the prompt says within a
  day. Either way the work fans out as one command per project under the
  scope: an organization or team save reaches every project in it.

  Background:
    Given an organization on a paid plan with two projects and stored data

  @unit
  Scenario: A longer period is applied to stored data without asking
    Given the organization keeps traces for 35 days
    When an admin saves 91 days for the organization
    Then every project's stored traces are raised to 91 days
    And no prompt is shown

  @unit
  Scenario: The count covers every project the admin can read under the scope
    Given traces older than the new period in both projects
    When the stored data past the organization's period is counted
    Then the count sums both projects, each at its own resolved period
    And a project the admin cannot read is left out of the count

  @integration
  Scenario: A shorter period asks to apply it with a count
    Given 1,234 stored traces older than the new period
    When an admin saves the shorter period
    Then a prompt says "1,234 traces older than 90 days will be deleted within a day."
    And it offers "Apply now" as a destructive action and "Not now"

  @integration
  Scenario: Applying a shorter period now rewrites every project under the scope
    Given stored traces in both projects stamped for 371 days
    When an admin applies the organization's 91 days to stored data
    Then one command per project rewrites its stored traces to 91 days
    And each project records the period it applied

  @integration
  Scenario: Not now leaves a note with an Apply button
    Given stored traces still on the old period under the scope in view
    When the settings page shows that scope
    Then it shows "1,234 traces still use the old period" with an Apply button
    And Apply asks first with the same prompt before any stored data is rewritten

  @integration
  Scenario: A count that fails still offers the choice
    Given counting the stored data fails
    When an admin saves a shorter period
    Then the prompt says the stored data could not be counted
    And it still offers "Apply now" and "Not now"
