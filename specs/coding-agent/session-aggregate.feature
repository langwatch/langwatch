Feature: Coding-agent sessions
  A coding-agent run is a session: many model calls, many tool runs, sometimes
  several traces, and telemetry arriving as spans, logs and metrics. LangWatch
  shows one session, assembled from whichever signals the agent sent, without
  double-counting and without hiding sessions that sent only some signals.

  Background:
    Given a project that receives coding-agent telemetry

  Scenario: a session assembles from spans, logs and metrics
    When an agent session sends spans, logs and metrics that share a session id
    Then the session shows its cost, token usage, tool activity and outcome as one record
    And its lines of code, commits and pull requests reflect what the agent reported

  Scenario: a session that sent only metrics still appears
    When an agent session sends metrics but no spans and no logs
    Then the session appears in the project's coding-agent usage with its cost and token totals

  Scenario: a denied tool is part of the session story
    When the human rejects a tool the agent asked to run
    Then the session records the denial
    And the denial is visible even though the tool never executed

  Scenario: a sub-agent run stays inside its parent session
    When an agent spawns a sub-agent that starts its own trace within the same session
    Then both traces belong to the same session
    And the session's totals include the sub-agent's work exactly once

  Scenario: an interactive child session stands alone
    When an agent launches a nested interactive session with its own session id
    Then the child appears as its own session with its own totals

  Scenario: re-delivered telemetry does not inflate a session
    When the same telemetry for a session is delivered again
    Then the session's cost and token totals are unchanged

  Scenario: the trace view shows its session
    When a user opens a trace that belongs to a coding-agent session
    Then the drawer offers the session view for that trace's session

  Scenario: traces from other sources are untouched
    When a user opens a trace that is not from a coding agent
    Then the trace view shows no coding-agent session surface
    And the trace renders exactly as before

  Scenario: a session without a session id is not lost
    When a coding-agent trace arrives whose telemetry carries no session id
    Then it appears as a single-trace session of its own

  Scenario: a session resumes from its own stored state after its cache is lost
    Given a session that has already recorded its work, including its sub-agents,
      its converged metrics and its per-call context bookkeeping
    And the in-memory copy of that session has been dropped
    When more telemetry arrives for the session
    Then the session resumes from its last stored state without re-reading its history
    And the new telemetry adds to the totals already recorded, not to an empty session
    And re-delivered telemetry the session had already counted does not inflate its totals
