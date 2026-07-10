@unimplemented
Feature: Langy turns are event-driven, survive deploys, and resume on refresh
  As a LangWatch user chatting with Langy
  I want my turn to keep running when I refresh or when a deploy happens
  So that I never lose an answer to a dropped connection or a stalled worker

  # Design: dev/docs/adr/044-langy-event-driven-turns.md
  # Blocked on PR1 (langy-agent telemetry + adapters/workerpool + adapters/egress)
  # and PR2 (langy_conversation aggregate: agent_turn_started, status_reported,
  # progress_reported, turn_finalized, agent_turn_failed; StartAgentTurn,
  # RecordStatus, RecordProgress, FinalizeTurn, ReconcileAgentTurn).
  #
  # This replaces the synchronous POST /chat proxy in src/server/routes/langy.ts
  # with the scenario execution pattern (scenarioExecution.reactor -> execution-pool,
  # wired via setPool() in src/workers.ts). Tokens live in a short-lived Redis
  # buffer; milestones and the final answer are durable events.

  Background:
    Given I am authenticated with permission to use Langy in my project
    And the Langy worker backend is available

  # ===========================================================================
  # Event-driven spawn (replaces the synchronous POST /chat trigger)
  # ===========================================================================

  Scenario: Sending a message starts a turn without holding the request on the worker
    When I send a message to Langy
    Then a turn is started for my conversation
    And the worker is spawned by reacting to the turn-started event, not by a direct proxy call
    And I begin receiving tokens as the worker produces them

  Scenario: A second message while a turn is in flight is rejected as busy
    Given a turn is already in flight for my conversation
    When I send another message in the same conversation
    Then the request is rejected as conversation-busy
    And the in-flight turn is left untouched

  Scenario: When the worker backend is at capacity the turn is not silently dropped
    Given the worker backend has no free capacity
    When I send a message to Langy
    Then I am told the assistant is at capacity
    And no turn is left stuck without a terminal state

  # ===========================================================================
  # Streaming persistence split (tokens in Redis, milestones + answer as events)
  # ===========================================================================

  Scenario: Tokens stream from the worker to my browser
    When Langy is generating a response
    Then I see tokens render as they arrive

  Scenario: Durable milestones are recorded as events, not as tokens
    When Langy searches traces and then opens a pull request during a turn
    Then the "searching traces" milestone is recorded durably on the conversation
    And the "pull request opened" milestone is recorded durably on the conversation
    And the raw token deltas are not written to the durable event log

  Scenario: The final answer is recorded durably when the turn completes
    When a turn completes
    Then the whole final answer is recorded as a durable turn-finalized event
    And reloading the conversation later shows that answer without any live worker

  # ===========================================================================
  # Refresh-resume mid-stream
  # ===========================================================================

  Scenario: Refreshing mid-stream replays what I missed and reattaches to the live edge
    Given Langy is part way through generating a response
    When I refresh the page and reopen the conversation
    Then I see the tokens produced so far
    And I then see the remaining tokens stream in live
    And the answer is complete when the turn finishes

  Scenario: Reopening a finished turn shows the answer from durable state
    Given a turn finished while I was away
    When I reopen the conversation
    Then I see the complete final answer
    And no worker is spawned to reproduce it

  Scenario: Reopening a long turn whose token buffer expired falls back to milestones
    Given a turn is still in flight but its live token buffer has expired
    When I reopen the conversation
    Then I see the durable milestones recorded so far
    And I am told the turn is still working and to reconnect shortly

  # ===========================================================================
  # Liveness: heartbeat + reconcile
  # ===========================================================================

  Scenario: A healthy turn keeps its liveness signal fresh
    Given a turn is in flight and progressing
    Then its liveness signal is refreshed while it runs
    And no reconciliation is triggered for it

  Scenario: A stalled turn is reconciled and retried
    Given a turn is in flight and made no side-effecting progress
    When the worker stops signalling liveness past the grace window
    Then the stalled turn is reconciled
    And a fresh attempt is started for the same conversation

  Scenario: A turn that exhausted its retries fails terminally
    Given a turn has already been retried the maximum number of times
    When it stalls again
    Then the turn fails with an exhausted reason
    And the failure is surfaced to me rather than retried forever

  Scenario: A turn that hit a hard error fails fast without retry
    Given a turn's worker reports a hard, non-retryable error
    When the turn is reconciled
    Then it fails fast with an error reason
    And it is not retried

  Scenario: A stalled turn that already opened a pull request is not blindly retried
    Given a turn stalled after it had already opened a pull request
    When the turn is reconciled
    Then it is not automatically retried
    And the outcome is surfaced to me instead of risking a duplicate pull request

  # ===========================================================================
  # Deploy survival (same machinery as refresh-resume)
  # ===========================================================================

  Scenario: A turn interrupted by a deploy is recovered by a surviving worker
    Given a turn is in flight when its worker pod is replaced during a deploy
    When another worker sweeps for turns with no live liveness signal
    Then the interrupted turn is reconciled
    And it reaches a terminal state instead of hanging forever

  Scenario: Recovery is driven by the liveness sweep, not by event replay
    Given a control-plane worker restarts and replays the conversation log
    When it encounters an in-flight turn during replay
    Then it does not re-spawn a worker from the replay itself
    And recovery is left to the liveness sweep so no side effect fires twice
