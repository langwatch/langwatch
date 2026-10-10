Feature: The checkup canaries run in a hidden project of their own
  The Ops checkup's canaries send and read test traces through the real public
  ingest and trace-read routes, but never in a customer's project. A hidden
  system organisation holds one hidden project the checkup owns; the canary key
  is minted for the checkup actor on that project only (Alex, 2026-10-10).

  @integration @unimplemented
  Scenario: The hidden organisation and project are created once by a migration step
    Given an install with no checkup organisation
    When the upgrade runs the checkup's migration step twice
    Then exactly one hidden "LangWatch checkup" organisation exists
    And it holds exactly one hidden "canary" project

  @integration @unimplemented
  Scenario: The hidden organisation and project are never listed where a person looks
    Given the checkup organisation and its project exist
    When a person lists organisations, projects, search results, seats, usage or billing
    Then neither the checkup organisation nor its project appears
    And no analytics, nurturing or onboarding fact names them

  @unit @unimplemented
  Scenario: The canary key reaches only the checkup project
    Given the canary key minted for the checkup actor
    When it sends a trace to the checkup project
    Then the trace is accepted
    When it sends or reads a trace naming any other project
    Then the request is refused
    And the key holds exactly "traces:create" and "traces:view"

  @integration @unimplemented
  Scenario: The checkup canary passes end to end without touching a customer project
    Given an organisation with its own projects
    When an operator runs the checkup
    Then the collector and processor canaries are verified
    And no trace was written to any project of that organisation

  @unit @unimplemented
  Scenario: The audit log names the checkup actor
    When the canary key sends and reads a trace
    Then each audit row names the actor "system:checkup-canary"

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
