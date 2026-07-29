Feature: Personal coding-agent usage
  A person who runs coding agents wants to see what their own sessions did and
  cost — in their personal workspace, across every agent they use, including
  sessions whose telemetry carried no spans.

  Background:
    Given a user whose coding-agent sessions have been ingested into their personal workspace

  Scenario: my recent usage at a glance
    When the user opens their personal workspace home
    Then they see their own recent coding-agent usage: cost, tokens, active time and sessions

  Scenario: usage counts metric-only sessions
    Given one of the user's sessions sent only metrics
    When the user views their usage
    Then that session's cost and tokens are included in the totals

  Scenario: usage is mine alone
    Given another user has coding-agent sessions in the same period
    When the user views their personal usage
    Then only their own sessions are counted

  Scenario: no usage yet
    Given the user has no coding-agent sessions
    When the user opens their personal workspace home
    Then no usage figures are shown for coding agents
