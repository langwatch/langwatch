Feature: The checkup canaries run in a hidden project of their own
  The Ops checkup's canaries send and read test traces through the real public
  ingest and trace-read routes at the install's public address, but never in a
  customer's project. A hidden system organisation holds one hidden checkup
  project; each run mints a short-lived key confined to that project and to the
  trace ids it sends (Alex, 2026-10-10).

  @unit
  Scenario: The hidden organisation and project are created once by a migration step
    Given an install with no system organisation
    When the upgrade runs the checkup's migration step twice
    Then exactly one organisation of kind "system" exists
    And it holds exactly one project of kind "internal_checkup"

  @unit
  Scenario: Running the checkup never creates the hidden project
    Given an install whose checkup migration step has not run yet
    When an operator runs the checkup
    Then the canary answers that the checkup project is not set up yet
    And no organisation or project was created

  @unit
  Scenario: The hidden organisation and project are never listed where a person looks
    Given the system organisation and its checkup project exist
    When organisations are listed for usage reports, provisioning or backfills
    Then the system organisation does not appear
    And creating it recorded no organisation-created fact for nurturing, analytics or onboarding

  @unit
  Scenario: The canary key is short-lived and holds only the trace permissions
    When the checkup mints its canary key
    Then the key is named "Checkup canary"
    And it is bound to the checkup project alone
    And it holds exactly "traces:create" and "traces:view"
    And it expires 5 minutes after it was minted

  @unit @unimplemented
  Scenario: The canary key reads only the trace ids it was minted for
    Given a canary key minted for trace ids "t-rest" and "t-otlp"
    When it reads trace "t-rest" through the public trace route
    Then the trace is returned
    When it reads trace "t-other" in the same project
    Then the trace is not found

  @unit @unimplemented
  Scenario: The canary key cannot ingest spans for any other trace id
    Given a canary key minted for trace id "t-rest"
    When it sends a span of trace "t-other"
    Then the span is refused

  @unit @unimplemented
  Scenario: A trace condition with no trace ids keeps its window semantics
    Given a shared grant whose trace condition has a from and an until and no trace ids
    When a member trace inside the window is read
    Then it is returned as before

  @integration @unimplemented
  Scenario: The checkup canary passes end to end without touching a customer project
    Given an organisation with its own projects
    When an operator runs the checkup
    Then the collector and processor canaries are verified
    And no trace was written to any project of that organisation
    And the canary key was revoked when the run ended

  @unit
  Scenario: The storage probe writes into the checkup project
    When an operator runs the checkup's storage probe
    Then the probe object is written for the checkup project
    And no customer project is touched

  @unit @unimplemented
  Scenario: The audit records which operator started the checkup
    When an operator runs the checkup
    Then the checkup's audit row names that operator
    And the canary's own calls are recorded as the canary key

  @unit @unimplemented
  Scenario: A run nobody started is still refused a trace read
    Given the key of a run nobody started, for project "alpha"
    When a trace search is sent with that key
    Then the answer is 403 "permission_denied"

  @unit @unimplemented
  Scenario: Canary traces expire like any other telemetry
    Given the checkup project's retention is the install default
    When a canary trace is older than that retention
    Then it is removed as any other trace is
