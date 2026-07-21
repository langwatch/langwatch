Feature: Langy's view of a conversation is the recorded conversation itself
  As someone chatting with Langy across refreshes, reconnects, and second tabs,
  I want the panel to render exactly what the backend has recorded — caught up live, step by step —
  So that what I see always survives a reload, never contradicts the real state of a turn,
  and never silently drifts from what actually happened.

  # The backend derives a conversation by folding recorded events into
  # projections. The frontend re-derives its own picture from ad-hoc booleans
  # and whole-projection refetches — a second, hand-written model that is free
  # to drift. This spec makes the frontend's picture the SAME fold: the client
  # loads the projected snapshot plus a position marker, then catches up by
  # applying only the recorded steps it has not seen, using the same pure fold
  # logic the backend uses (shared via packages/langy).
  #
  # This EVOLVES specs/langy/langy-frontend-realtime.feature, and keeps its
  # core invariant: the real-time channel still never pushes conversation data
  # — the signal stays lightweight. What changes is what the client does next:
  # instead of re-downloading whole projections ("signal-then-refetch"), it
  # fetches only the recorded steps after its position and folds them locally
  # ("signal-then-fold-the-tail"). Its slim-list/heavy-detail scenarios and its
  # single-SSE-coordinator scenarios stand unchanged.
  #
  # Companion specs:
  #   - specs/langy/langy-event-sourced-conversations.feature (the backend fold)
  #   - specs/langy/langy-frontend-realtime.feature (the signal transport + list)
  #   - specs/langy/langy-stop-and-resume.feature (stop/continue/rejoin controls)
  #   - specs/langy/langy-dual-stream.feature (the ephemeral token fast-path)
  #
  # ADR: dev/docs/adr/059-event-sourced-langy-frontend.md

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open on a conversation

  # ===========================================================================
  # One fold, two sides — the client and server can never disagree
  # ===========================================================================

  # The fold logic that turns recorded steps into a turn's state lives in ONE
  # shared place. The server folds durably; the browser folds locally; a turn
  # therefore renders identically on both sides because it is literally the
  # same computation.

  @unit
  Scenario: The same recorded steps produce the same turn state on both sides
    Given the recorded steps of a completed turn
    When the browser folds them locally
    And the backend folds them durably
    Then both arrive at the identical turn state

  @unit
  Scenario: Applying a recorded step the view has already seen changes nothing
    Given the browser's view is caught up to a recorded step
    When the same step is delivered again
    Then the view is unchanged
    And no part of the conversation renders twice

  @unit
  Scenario: Recorded steps apply in recorded order, not arrival order
    Given two recorded steps arrive out of order
    When the browser folds its catch-up
    Then the resulting state reflects the recorded order

  # ===========================================================================
  # Loading: snapshot first, then only the missing tail
  # ===========================================================================

  # The client never replays a conversation's full history — the projected
  # snapshot IS the folded history. Opening a conversation reads the snapshot
  # plus its position, subscribes for updates, and folds only what happened
  # after that position.

  @integration
  Scenario: Opening a conversation folds only what the snapshot has not seen
    Given a conversation with a long history
    When I open it
    Then the view starts from the projected snapshot
    And only the recorded steps after the snapshot's position are fetched and folded
    And the full event history is never downloaded

  @integration
  Scenario: A step recorded while the snapshot was loading is not lost
    Given a recorded step lands between the snapshot read and the live subscription catching up
    When the view finishes loading
    Then that step is folded exactly once
    And the view shows the state including it

  # ===========================================================================
  # Live updates repair themselves
  # ===========================================================================

  # Any live signal means "you may be behind" — the client catches up from its
  # own position. A dropped signal is therefore never a lost update, only a
  # deferred one; the next signal (or reconnect) repairs the gap in one fetch.

  @integration
  Scenario: A missed live signal is repaired by the next one
    Given my connection dropped one live signal
    When the next signal arrives
    Then the view catches up with every recorded step since its position
    And nothing is skipped and nothing renders twice

  @integration
  Scenario: Coalesced signals still deliver every recorded step
    Given several steps were recorded in a quick burst
    When the burst reaches me as a single signal
    Then the view catches up with all of the burst's steps

  @integration
  Scenario: Reconnecting after being away catches up in one step
    Given the tab was offline while Langy finished the turn
    When the tab reconnects
    Then the completed reply and the settled turn state appear
    And the composer accepts a new message

  # ===========================================================================
  # Refresh and rejoin — the recorded state survives the browser
  # ===========================================================================

  # These land the remaining half of langy-stop-and-resume: rejoining is just
  # "load snapshot, fold tail, reattach the token stream" — the same mechanism
  # as any other load, not a special recovery path.

  @integration
  Scenario: Refreshing mid-reply carries on from where the turn was
    Given Langy is midway through replying
    When I refresh the page
    Then the words already written are shown, not a blank turn
    And the reply continues live to completion

  @integration
  Scenario: A stopped turn looks stopped after a refresh
    Given I stopped a turn partway
    When I refresh the page
    Then the turn shows as stopped with its partial answer kept

  # ===========================================================================
  # The composer follows the recorded turn, not a lucky cache
  # ===========================================================================

  # ADR-058 made the composer's availability a state machine; here that state
  # becomes a DERIVATION of the recorded turn — with one honest exception: the
  # instant between clicking Send and the backend accepting the turn, where an
  # optimistic pending marker covers the gap and reconciles against the record.

  @integration
  Scenario: Sending stays unavailable exactly while a turn is recorded in flight
    Given a turn is recorded as in progress
    Then the composer does not send
    When the turn reaches a recorded terminal
    Then the composer becomes available

  @integration
  Scenario: A just-sent message appears at once and settles as recorded
    When I send a message
    Then my message appears in the conversation immediately
    And it reconciles with the recorded turn once the backend accepts it

  @integration
  Scenario: A send the backend rejects rolls back cleanly
    Given the backend refuses my turn with a clear reason
    Then my draft returns to the composer
    And the conversation shows no phantom turn

  # ===========================================================================
  # Tokens stay ephemeral; the record stays authoritative
  # ===========================================================================

  # The dual-stream split (ADR-048) is unchanged: streamed tokens are the fast
  # ephemeral path for text, and the recorded steps are the durable truth. The
  # streamed text reconciles against the folded answer — never the other way
  # around.

  @integration
  Scenario: Streamed text never regresses the folded answer
    Given the folded record already carries part of Langy's answer
    When older streamed tokens arrive late
    Then the rendered answer never gets shorter

  # ===========================================================================
  # Authorization: updates reach exactly the people who may read
  # ===========================================================================

  # The live channel is project-wide, so visibility is enforced per recorded
  # update, fail-closed — and the catch-up fetch is authorized exactly like
  # reading the conversation. Nobody can receive a step they could not read.

  @integration
  Scenario: A private conversation's updates stay with its owner
    Given another project member with their own session
    When Langy records progress on my private conversation
    Then the other member's session receives nothing about it
    And their catch-up fetch for it is refused with a clear reason

  @integration
  Scenario: A shared conversation updates every member watching it
    Given the conversation is shared with the project
    And another member has it open
    When Langy records progress
    Then the other member sees the progress without reloading
