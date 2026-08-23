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

  # A busy session can queue its whole transcript faster than it is written.
  # Writing those contributions together is what keeps up, but the session's
  # story is told in order — so the grouping must not reorder it.
  Scenario: a busy session's contributions are written together
    Given a session queueing telemetry faster than it is written
    When its waiting contributions are written
    Then they are written as one batch
    And not one write per contribution

  Scenario: writing contributions together keeps the session's order
    Given several of a session's contributions written together
    When the session is assembled from them
    Then they apply in the order the agent produced them

  Scenario: an agent that reports only logs keeps its model-call sequence
    Given an agent whose model calls are reported as logs rather than spans
    When a run of its model calls is written together
    Then the session's context growth, final request and stop reason match the last call in that run

  Scenario: a reported rate limit is counted apart from an inferred one
    When an agent session reports rate-limit events and separately fails an API call with a 429
    Then the session counts the reported rate-limit events on their own
    And the 429-inferred count is unchanged by them

  Scenario: compactions are told apart by what triggered them
    When an agent session compacts automatically twice and once at the user's request
    Then the session records two automatic compactions and one manual one
    And a compaction that names no trigger is counted as unknown

  Scenario: a spawned session knows its parent
    When a session's telemetry names the session that spawned it as a fork
    Then the session records its parent and that it forked the parent's context
    And later telemetry does not change who the parent was

  # Codex sessions. Codex reports the turn on a span and everything else on
  # events: there is no tool span, tokens arrive as turn totals whose input
  # includes the cache buckets, and the turn span's name carries no vendor
  # namespace. The scenarios below pin the codex-specific reading.

  Scenario: a codex turn span folds the turn's model call and tokens
    When a codex session's turn span reports the turn's model and token totals
    Then the session counts one model call for the turn
    And the token buckets stay disjoint, with the cached input counted once

  Scenario: a codex session is priced from the tokens it reported
    Given a codex session, whose telemetry states no price of its own
    When its turn span reports the model and the token totals
    Then the session's cost is worked out from those tokens at that model's price
    And a second turn adds its own price to the session's total
    # Without this a codex session reads as free, while the same turn's trace
    # states a figure: the trace pipeline prices the identical span.

  Scenario: a turn priced at an unknown model costs nothing rather than guessing
    Given a codex turn whose model is in no price list
    When the turn is folded
    Then the session's tokens are counted and its cost stays at zero

  Scenario: an agent that states its own price keeps it
    Given a session whose telemetry reports what it was billed
    When its model calls are folded
    Then the session's cost is the reported one, never a second estimate

  Scenario: a codex shell command counts once despite its sandbox outcome event
    When a codex session runs one shell command that reports a tool result and a sandbox outcome
    Then the session counts one tool run

  Scenario: a codex denial and a codex abort are the human's decisions, not failures
    When a codex session's tool prompts are denied, aborted and left to time out
    Then the denials and the walk-aways are counted apart
    And none of them counts as a failed tool

  Scenario: codex time to first token folds from its own event
    When a codex session reports time to first token on its own event
    Then the session's mean time to first token reflects it

  Scenario: a foreign span reusing codex's bare turn name is declined at the gate
    Given a span named like codex's turn span from an unrelated instrumentation
    When the span dispatcher considers it
    Then it never reaches the session fold

  Scenario: the codex script wrapper is plumbing, its commands are the tool runs
    Given a codex session where the model sends one script that runs one command
    When the script wrapper and the command each report a tool result
    Then the session counts one tool run, named after the command

  Scenario: a codex record outside any session does not mint a session
    Given a codex log record that carries no session id
    When the log dispatcher considers it
    Then no session contribution is made for it
    And the record itself is still stored
