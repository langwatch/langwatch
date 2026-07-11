Feature: Langy dual-stream — a raw token fast-path beside the durable event-sourced stream
  As a user watching Langy answer
  I want the answer to start typing instantly and smoothly, token by token
  So that Langy feels fast, while the durable reconciled answer stays the source of truth

  # ADR-048. Two streams run per turn:
  #   - Stream A (durable, the truth): the ADR-044/046 path — the Redis token
  #     buffer bridged to useChat, the event-sourced turn_finalized final answer,
  #     the langy_conversation_updated broadcast, ephemeral status/progress. It
  #     survives refresh (the buffered tail is the resume state). UNCHANGED.
  #   - Stream B (speed, ephemeral): raw opencode text-delta tokens, minimally
  #     parsed, streamed straight to the browser over a per-turn Redis pub/sub
  #     channel. Not persisted; dies on disconnect.
  #
  # Companion specs:
  #   - specs/langy/langy-event-driven-turns.feature (Stream A transport)
  #   - specs/langy/langy-frontend-realtime.feature (Stream A frontend)

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open

  # ---------------------------------------------------------------------------
  # Manager: the multiplexed fast frame
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The manager emits a raw token frame for a text delta
    Given the worker's opencode stream produces a text delta for the routed session
    When the manager forwards the turn
    Then it writes a compact raw token frame carrying the delta text verbatim
    And it still forwards the full parsed event as before
    And the raw token frame is flushed ahead of the full event line

  @unit
  Scenario: The manager emits no raw token frame for a non-text event
    Given the worker's opencode stream produces a tool-call or lifecycle event
    When the manager forwards the turn
    Then it forwards the full parsed event
    And it writes no raw token frame for that event

  @unit
  Scenario: Terminal detection and session routing are unchanged by the fast frame
    Given the worker's opencode stream produces a terminal event
    Then the turn stream still ends on the terminal event
    And events for another worker's session are still not forwarded

  # ---------------------------------------------------------------------------
  # Control plane: split at the turn processor, ephemeral pub/sub
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Raw tokens are fanned to the ephemeral fast channel, deltas to the durable buffer
    Given a turn is running for a conversation
    When the manager sends raw token frames and full text-delta events
    Then the raw tokens are published to the per-turn fast channel
    And the durable token buffer is fed by the full text-delta events exactly as before

  @integration
  Scenario: The fast stream endpoint streams raw tokens to the browser
    Given a turn is running for a conversation I own
    When I open the fast stream for that turn
    Then I receive the raw tokens as they are published
    And the stream ends when the turn signals end
    And the stream closes when I disconnect

  @integration
  Scenario: The fast stream refuses a turn I cannot see
    Given a conversation that is not mine and not shared
    When I open the fast stream for that turn
    Then the request is refused

  @integration
  Scenario: The fast stream is best-effort and never replays
    Given a turn produced tokens before I subscribed
    When I open the fast stream late
    Then I only receive tokens published after I subscribed
    And no error is raised for the tokens I missed

  # ---------------------------------------------------------------------------
  # Frontend reconciliation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The optimistic text leads while it is a superset of the durable text
    Given the durable text so far is a prefix of the fast text
    When the answer is reconciled for display
    Then the fast text is shown

  @unit
  Scenario: The durable text wins when the fast text has a gap
    Given the fast text is not a prefix-consistent superset of the durable text
    When the answer is reconciled for display
    Then the durable text is shown

  @integration
  Scenario: The optimistic answer is swapped for the persisted message on finalize
    Given Stream B has been typing the optimistic answer
    When the turn finalizes on Stream A
    Then the persisted final message is rendered
    And the tool-call cards settle to their final state

  @integration
  Scenario: A mid-stream refresh loses Stream B but Stream A replays the durable state
    Given a turn is streaming and I refresh the page
    Then the optimistic Stream B text is gone
    And Stream A replays the buffered token tail so no work is lost
