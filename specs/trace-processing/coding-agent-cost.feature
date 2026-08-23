Feature: Coding-agent cost, one formula on every surface
  As a customer tracking what my coding agents spend
  I want the terminal footer, the trace header and the Usage tab to state one cost
  So that two screens never disagree about the same session

  Background:
    Given a Claude Code session ingested through OTLP
    And the model price registry carries the provider's published rates

  # Anthropic bills an hour-long cache entry at 2x the input rate and a
  # five-minute entry at 1.25x. The llm_request span states how many tokens
  # were written but not how long they live. The span's own request context
  # states which policy applies: measured against Claude Code, a main-thread
  # request ("interaction") writes hour-long entries and a sub-agent request
  # ("tool") writes five-minute ones. The agent-reported cost drift signal
  # below is what catches the day the provider changes this policy.

  @unit
  Scenario: A main-thread call's cache writes price as hour-long entries
    Given a claude_code.llm_request span whose llm_request.context is "interaction"
    And the span reports cache-write tokens with no lifetime split of its own
    When the span is canonicalised
    Then its cache writes carry the hour-long count
    And every surface prices the call at the amount the provider charged

  @unit
  Scenario: A sub-agent call's cache writes price as five-minute entries
    Given a claude_code.llm_request span whose llm_request.context is "tool"
    When the span is canonicalised
    Then no hour-long count is asserted
    And the call prices its writes at the five-minute rate

  @unit
  Scenario: A main-thread call known only by its query source prices the same way
    Given a claude_code.llm_request span with no llm_request.context attribute
    And the span states a main-thread query source
    When the span is canonicalised
    Then its cache writes carry the hour-long count
    And the trace surfaces and the session fold state one figure for the call

  @unit
  Scenario: A call with no stated context prices its writes conservatively
    Given a claude_code.llm_request span with no llm_request.context attribute
    When the span is canonicalised
    Then no hour-long count is asserted

  @unit
  Scenario: A provider-stated split is never overwritten
    Given a claude_code.llm_request span that already carries an hour-long cache count
    When the span is canonicalised
    Then the provider's own count is kept

  @unit
  Scenario: The session's cost is computed from tokens, same formula as the trace
    Given a Claude Code session with model calls on its llm_request spans
    When the session fold prices the session
    Then the session's cost equals the sum of the same calls priced by the trace pipeline
    And the cost the agent reported about itself is folded into a separate figure

  @unit
  Scenario: The agent-reported figure is kept as a drift signal
    Given the agent reports a cost for a call on its api_request event
    When the session fold applies the event
    Then the reported amount accumulates on the session without touching the computed cost
    # The two figures disagreeing is the alarm: it means either our price
    # registry or the agent's own pricing went stale.

  @unit
  Scenario: A logs-only agent keeps its reported cost as the session cost
    Given an agent whose telemetry has no spans and reports cost on its api_request events
    When the session fold prices the session
    Then the reported cost is the session's cost
    # With no token-bearing span there is nothing to compute from.

  @unit
  Scenario: Saturated session sets state their bound
    Given a session that touched more traces, sub-agents or files than the fold retains
    When the Usage tab renders the session
    Then each saturated card states the value as a lower bound, not an exact count

  @unit
  Scenario: The terminal footer states the session total next to the running figure
    Given a session replay opened on one of many turns
    When the footer renders cost
    Then the running figure covers the loaded steps up to the reader's position
    And the session total comes from the session row, the same source the Usage tab reads
