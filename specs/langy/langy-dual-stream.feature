Feature: Langy dual-stream — a raw token fast-path beside the durable event-sourced stream
  As a user watching Langy answer
  I want the answer to start typing instantly and smoothly, token by token
  So that Langy feels fast, while the durable reconciled answer stays the source of truth

  # ADR-048. Two streams run per turn:
  #   - Stream A (durable, the truth): the ADR-044/046 path — the Redis token
  #     buffer bridged to useChat, the event-sourced agent_responded final answer,
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
  # Manager: the pre-first-frame status names the true transition
  # ---------------------------------------------------------------------------

  # Between the prompt POST and the agent's first frame the worker prepares its
  # tools and produces nothing. The manager fills that silence with a status —
  # but the status must name what is actually happening, and it must not repeat
  # the same line on every message of a conversation.

  @unit
  Scenario: A worker that has not served a turn yet says Langy is waking up
    Given a turn is dispatched to a worker that has not served a turn yet
    When the manager opens the turn
    Then it emits a wake-up status such as "Waking Langy up…", "Giving Langy a pep talk…" or "Poking Langy…" before the first agent frame
    And the line varies between conversations instead of repeating one phrase

  @unit
  Scenario: A warm worker gets a short reaching-Langy line that varies
    Given a turn is dispatched to a worker that has already served a turn
    When the manager opens the turn
    Then it emits a short status such as "Paging Langy…" or "Pinging Langy…"
    And the line varies between turns instead of repeating one phrase

  @unit
  Scenario: A resumed turn says it is picking up where it left off
    Given a turn resumes from a shutdown handoff
    When the manager opens the turn
    Then it emits a "Picking up where it left off…" status

  # Reasoning (the model's thinking) is its own ephemeral stream, shown while the
  # reply is being worked out and then discarded. It is NOT the answer: it never
  # joins the durable final, never becomes a message part, and never reloads. The
  # user sees Langy think, live, and when the turn settles the thinking is gone.
  @unit
  Scenario: The manager emits a reasoning frame for a reasoning delta
    Given the worker's opencode stream produces a reasoning delta for the routed session
    When the manager forwards the turn
    Then it writes a reasoning frame carrying the thinking text
    And a reasoning delta is not treated as an answer token

  @integration
  Scenario: Reasoning streams to the browser and vanishes when the turn settles
    Given a turn is running for a conversation I own
    When the worker streams reasoning while it works
    Then I see the reasoning appear live while the reply is in flight
    And the reasoning is never written to the durable answer
    And the reasoning is cleared when the turn finishes, so it does not reload

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

  # ---------------------------------------------------------------------------
  # Transport honesty: streaming must actually stream, end to end
  # ---------------------------------------------------------------------------

  # The Node→Hono bridge used to buffer EVERY request body before Hono ran, so
  # the worker's ndjson relay connection — written as an incremental line
  # reader — received the whole turn in one burst milliseconds after the turn
  # ended. Nothing downstream can be live if the bridge is store-and-forward.
  @integration
  Scenario: The relay's ndjson frames are processed as they arrive, not after the turn ends
    Given the worker holds an open ndjson frame connection for a turn
    When it pushes a frame and keeps the connection open
    Then the relay handles that frame before the next frame is even sent
    And non-streaming request bodies are still delivered whole, exactly as before

  # The durable token buffer used to hold tokens until ~64 words accumulated,
  # so short answers rendered nothing until the turn was nearly over.
  @unit
  Scenario: The first token of a turn renders immediately
    Given a turn starts producing text
    When the first delta reaches the durable token buffer
    Then it is flushed to the stream immediately, without waiting for a batch

  @unit
  Scenario: Buffered tokens flush on a short clock, not only on volume
    Given a turn is streaming text slower than the batch size
    When a moment passes with tokens still pending
    Then the pending text is flushed without waiting for the batch to fill
    And a fast stream still batches, so the stream write volume stays bounded
