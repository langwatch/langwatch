@unit
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

  Scenario: a stale hint degrades to a slower read, not a missing session
    Given a session whose stored start time no longer matches the caller's hint
    When the session is looked up with that hint
    Then the lookup retries without the time bound and returns the session

  Scenario: traces from other sources are untouched
    When a user opens a trace that is not from a coding agent
    Then the trace view shows no coding-agent session surface
    And the trace renders exactly as before

  Scenario: a session without a session id is not lost
    When a coding-agent trace arrives whose telemetry carries no session id
    Then it appears as a single-trace session of its own

  Scenario: a Cowork session is an agent session
    When Claude Cowork exports its session telemetry as events only, under one session id
    Then the session appears with its turns, tool activity, costs and token totals
    And the session is identified as Cowork

  Scenario: Cowork telemetry that shares Claude Code's event vocabulary is still Cowork
    When a session's events carry Claude Code's event names but declare the Cowork service
    Then the session is identified as Cowork, not Claude Code

  Scenario: a session whose earliest signal arrives late is listed once, up to date
    Given a session whose first telemetry to arrive was not its earliest
    When the earlier signal arrives and moves the session's start time
    And the project's sessions are listed for the period the session now starts in
    Then the session appears once
    And it shows its latest totals rather than the ones it had before that signal

  Scenario: a session is never listed under a start time it has moved off
    Given a session whose first telemetry to arrive was not its earliest
    When the earlier signal arrives and moves the session's start time
    And the project's sessions are listed for a period the session no longer starts in
    Then the session is not listed for that period
    And no version of it is shown with the totals it held before that signal

  Scenario: a session stored as two indistinguishable versions is listed once
    Given two stored versions of one session that cannot be told apart by update time
    When the project's sessions are listed
    Then the session appears once
    And it shows the totals of the version that folded the most telemetry

  Scenario: a user-narrowed list is never answered from a superseded version
    Given a session whose newest version was folded from telemetry that reports no user
    When that user's sessions are listed
    Then the session is not listed
    And an older version of it is not shown in its place

  Scenario: a page is never shortened by collapsing a session's tied versions
    Given more sessions than fit one page, each stored as versions that cannot be told apart by update time
    When a page of the project's sessions is listed
    Then the page holds as many distinct sessions as were asked for

  # Not shipped: the session's retention deadline is anchored on a start time
  # that a late earlier signal can still move, so it can move closer. The freeze
  # that makes this true is ADR-071 sequencing step 3. Recorded as the target.
  @unimplemented
  Scenario: a late signal does not shorten how long a session is kept
    Given a session near the end of the project's retention period
    When a signal arrives reporting an earlier start than the session had
    Then the session is still available for the rest of its retention period

  Scenario: the most complete version of a session is the one that is read
    Given two stored versions of one session that cannot be told apart by update time
    When the session is read
    Then the version that folded the most telemetry is returned
    And reading it again returns that same version
