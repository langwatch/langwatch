@coding-agent
Feature: Per-call session events for context economics
  As an engineer analyzing coding-agent sessions
  I want every session event (model call, compaction, rate limit, tool run, prompt) as its own stored row
  So that per-call context growth, cost curves, and compaction effects are queryable instead of erased by session totals

  # The session aggregate (coding_agent_sessions) converges a session into
  # one row of totals. This feature stores the SEQUENCE next to it: the
  # coding_agent_session_events table, fed by a map projection over the
  # pipeline's log contributions, replayable over stored history.

  @unit
  Scenario: a model API call becomes one row with its economics
    Given a log contribution whose facts carry event.name api_request with tokens, cost, duration, model and request id
    When the session events projection maps it
    Then the row's kind is model_call
    And the row carries the input, output, cache read and cache creation token counts
    And the row carries the cost, duration and model

  @unit
  Scenario: a compaction becomes one row with its before and after tokens
    Given a log contribution whose facts carry event.name compaction with pre_tokens, post_tokens and trigger
    When the session events projection maps it
    Then the row's kind is compaction
    And the row carries the pre and post token counts and the trigger

  @unit
  Scenario: rate limit events become rows
    Given a log contribution whose facts carry event.name rate_limit_event
    When the session events projection maps it
    Then the row's kind is rate_limit

  @unit
  Scenario: a sub-agent's model call is attributable per call
    Given an api_request contribution whose query_source is agent:builtin:general-purpose
    When the session events projection maps it
    Then the row's agent type is general-purpose

  @unit
  Scenario: namespaced event names map the same as bare ones
    Given a log contribution whose facts carry event.name claude_code.api_request
    When the session events projection maps it
    Then the row's kind is model_call

  @unit
  Scenario: events outside the row vocabulary contribute no row
    Given a log contribution whose facts carry event.name hook_execution_complete
    When the session events projection maps it
    Then no row is produced

  @integration
  Scenario: re-delivery does not duplicate a row
    Given the same session event row written twice
    When the session's events are listed
    Then the event appears exactly once

  @integration
  Scenario: a session's events list in time order with stable pagination
    Given a session with more stored events than one page
    When the events are listed page by page using the returned cursor
    Then every event appears exactly once in ascending time order

  @unit
  Scenario: the CLI lists a session's events
    Given the session events endpoint returns pages with a cursor
    When I run "langwatch session events" for a session
    Then the CLI walks the cursor until the limit and prints one line per event

  # Span-only agents (codex today) have no api_request log carrier, so they
  # produce no model_call rows in this table; their sessions still fold into
  # coding_agent_sessions from spans. The degradation is: no rows, never
  # wrong rows.
  @unit
  Scenario: contributions without a mappable event name degrade to no rows
    Given a log contribution whose facts carry no event.name
    When the session events projection maps it
    Then no row is produced

  # TimeUnixMs is the fact table's partition key. Reading a session's events
  # without a bound on it opens every week the retention holds, cold storage
  # included, to answer about a session that lived for minutes.
  Scenario: reading a session's events prunes to the session's own weeks
    Given a session whose events are asked for without a time window
    When its events are read
    Then the read is bounded to the weeks around when the session started

  Scenario: a session longer than the guessed window still answers in full
    Given a session whose events fall outside the window guessed for it
    When its events are read
    Then the read is retried without a window rather than answering empty

  Scenario: a caller's own window is never widened behind its back
    Given a caller that asked for a specific time window
    When its events are read
    Then only that window is read
