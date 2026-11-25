Feature: A daily check flags stored rows on a period other than the setting

  Every stored row carries its own retention, stamped when it was written. A
  changed period that was never applied leaves old rows on the old stamp, and
  ClickHouse deletes them on that stamp. Once a day the worker samples each
  project's stored rows in a few one-hour windows, never the whole table, and
  compares the stamps with the period the project resolves to now. A project
  whose rows differ is recorded as a retention_drift_detected fact, counted on
  the langwatch_data_retention_drift_projects_total metric and logged, so the
  team sees the gap before a customer does.

  Background:
    Given an organization with a retention rule and two projects

  @unit
  Scenario: The daily wake asks for one check per organization with rules
    When the drift check wakes
    Then one check command is sent per organization holding a retention rule
    And a repeated wake for the same instant asks for the same sweep once

  @unit
  Scenario: An organization whose check cannot be sent is counted, not fatal
    Given sending the check for one organization fails
    When the drift check sweeps
    Then the other organizations are still asked
    And the failure is counted and logged

  @unit
  Scenario: The daily sweep prunes the check's sent outbox rows
    When the drift check wakes
    Then the check's dispatched outbox rows older than a week are deleted

  @unit
  Scenario: A failed outbox prune does not fail the drift sweep
    Given deleting the dispatched outbox rows fails
    When the drift check wakes
    Then the sweep still resolves

  @unit
  Scenario: The windows sampled are a few short slices spread over the stored age
    When the windows to sample are chosen
    Then each window is one hour long and none is newer than a day
    And there are at most ten of them

  @integration
  Scenario: Stored rows on another period are flagged
    Given a project resolves to 91 days for traces
    And stored traces in a sampled window are stamped for 30 days
    When the drift check runs for the organization
    Then a retention_drift_detected fact names the project, traces, 91 days expected and 30 days found
    And the drift metric and an error log name the project

  @integration
  Scenario: Stored rows on the current period are not flagged
    Given every sampled stored trace is stamped for the period the project resolves to
    When the drift check runs for the organization
    Then no drift is recorded

  @integration
  Scenario: A row outside the sampled windows is not read
    Given a stored trace stamped for 30 days outside every sampled window
    When the drift check runs for the organization
    Then no drift is recorded

  @unit
  Scenario: A project whose rows cannot be read is skipped and the rest are checked
    Given reading one project's stored rows fails
    When the drift check runs for the organization
    Then the other project is still checked
    And the failure is logged
