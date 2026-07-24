Feature: Langy lets me stop a turn for real, continue where it left off, and rejoin a turn after a refresh
  As someone chatting with Langy who changes their mind mid-answer, or reloads the tab,
  I want Stop to actually halt the work (not just my browser), a way to pick the answer back up,
  and a refresh to rejoin the turn already in flight,
  So that I stay in control of a live turn instead of watching a runaway generation I cannot steer.

  # Three user-initiated controls over one in-flight turn, built on the durable
  # event-sourced turn lifecycle (ADR-046) and the durable token buffer / resume
  # transport (ADR-044/048). Companion specs:
  #   - specs/langy/langy-turn-recovery.feature  (INFRA-initiated recovery: a worker
  #     dies, a deploy interrupts — Langy re-drives on its own. This spec is the
  #     opposite direction: the USER intervenes on a healthy turn.)
  #   - specs/langy/langy-frontend-realtime.feature  ("A turn in flight resumes after
  #     a page refresh" — this spec makes that scenario real, end to end.)
  #   - specs/langy/langy-baseline.feature  ("Stop an in-flight generation" — the v1
  #     stub; this spec deepens it into a backend-confirmed stop.)
  #
  # ADR: dev/docs/adr/NNN-langy-user-turn-controls.md

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open

  # ===========================================================================
  # (1) Stop, for real — the backend confirms, the browser does not pretend
  # ===========================================================================

  # The old Stop was a lie: it aborted the browser's subscription and let the
  # agent keep running, keep calling tools, and keep spending tokens against a
  # question the user had already abandoned. A real Stop must reach the backend,
  # end the turn on the durable record, and only THEN tell the user it stopped —
  # the confirmation comes from the turn's terminal, not from an optimistic UI.

  @integration
  Scenario: Stopping a turn ends it on the backend, not just in my browser
    Given Langy is streaming an answer to my question
    When I click Stop
    Then the turn reaches a terminal on the durable record
    And the conversation returns to a settled, non-running state
    And the live stream ends, so the UI is not left spinning on a turn nothing is driving

  # "The partial response is preserved" (langy-baseline). What was streamed so far
  # is the durable truth — reconstructed from the token buffer, never from whatever
  # the browser happened to have painted — so it survives a reload and can anchor a
  # continuation.
  @integration
  Scenario: A stopped turn keeps the words Langy had already written
    Given Langy has streamed a partial answer to my question
    When I stop the turn
    Then the partial answer is kept as Langy's message on the conversation
    And reloading the conversation still shows that partial answer
    And the stopped message is not rendered as a red error

  # The distinguishing act of THIS spec versus langy-turn-recovery: a stop is
  # neither a success nor a failure. It is its own terminal outcome, carried on the
  # same "the agent responded" event that carries a completed answer (it has an
  # answer to carry), so it reuses the one-terminal-per-turn machinery rather than
  # inventing a parallel one.
  @unit
  Scenario: A stop is recorded as a distinct outcome, not a failure
    Given a turn is in flight
    When the user stops it
    Then the turn's terminal records a "stopped" outcome carrying the partial answer
    And the conversation is left settled and continuable, not failed
    And no error is recorded against the turn

  # The race that the turn-terminal slot already guards: the user hits Stop in the
  # same instant the agent finishes. Exactly one terminal wins. If the real answer
  # landed first, stopping is moot and the user simply gets the whole answer.
  @unit
  Scenario: Stop racing a natural finish resolves to exactly one terminal
    Given a turn is about to finish on its own
    When a stop and the natural completion race to terminate the same turn
    Then only the first terminal is recorded
    And the second is collapsed as a duplicate, leaving one answer on the conversation

  @integration
  Scenario: If the answer already arrived, Stop is a harmless no-op
    Given the turn already completed and its answer is on record
    When I click Stop a beat too late
    Then the completed answer stays intact
    And nothing is overwritten or re-marked as stopped

  # The token-burn half of "for real": stopping must tell the worker to abandon the
  # opencode session so the model stops generating. This is best-effort layered on
  # top of the durable terminal — if the signal never reaches a wedged worker, the
  # stop is still truthful (the turn is terminal, the stream ended, the late worker
  # frame is dropped by the one-terminal guard); only the wasted tokens are the cost.
  @integration
  Scenario: Stopping asks the worker to abandon the running generation
    Given the worker is actively generating my answer
    When I stop the turn
    Then the worker is signalled to cancel the in-flight generation
    And a late result from that worker cannot resurrect or duplicate the stopped turn

  # Stop must be honest about latency: the click cannot claim success before the
  # backend has confirmed. The button reflects a "stopping…" state until the
  # terminal lands, then settles to stopped.
  @integration
  Scenario: Stop shows it is stopping until the backend confirms
    Given Langy is streaming and I click Stop
    Then the control shows it is stopping
    And it settles to stopped only once the turn's terminal has been recorded
    And it never reports stopped while the turn is still running on the backend

  @integration
  Scenario: Only someone who can control the conversation may stop its turn
    Given a conversation and turn I am not allowed to control
    When I try to stop that turn
    Then the request is refused
    And the turn keeps running untouched

  # --- Stopping a turn this browser tab did not start -------------------------
  #
  # A tab knows the id of a turn IT sent. A turn adopted from the durable record
  # — started in another tab, or rejoined after a refresh — arrives as "a turn is
  # in flight" with no id attached, and a stop needs an id. So Stop was offered,
  # the control moved to "Stopping", and nothing was ever sent: the agent kept
  # running and the tab sat there until the turn ended on its own.
  #
  # The id is not the browser's to invent. The durable record already names the
  # turn it has in flight, so the conversation read carries it and any tab can
  # stop the turn — including one that owns nothing, which is the case a
  # tab-to-tab message could never cover (there may be no other tab).

  @integration
  Scenario: Stopping a turn another tab started really stops it
    Given a turn is in flight that this tab did not start
    When I click Stop in this tab
    Then the stop is dispatched against the turn the durable record names
    And that turn reaches a stopped terminal

  @integration
  Scenario: Stopping a turn no open tab owns really stops it
    Given a turn is still running after the tab that started it was closed
    And I open the conversation in a new tab
    When I click Stop
    Then the stop is dispatched against the turn the durable record names
    And that turn reaches a stopped terminal

  # The honesty rule, made structural: the control moves to "stopping" ONLY on
  # the branch that dispatches a stop. There is no path that shows the stopping
  # spinner without a request behind it.
  @unit
  Scenario: Stop says nothing it cannot back up
    Given a turn is in flight but no turn id is known yet
    When I click Stop
    Then no stop is dispatched
    And the control stays on Stop rather than showing it is stopping
    And I am told the turn cannot be stopped yet

  @unit
  Scenario: A stop that never reached the backend hands the control back
    Given I clicked Stop and the request failed to reach the backend
    Then the control returns to Stop
    And the turn is still shown as running, because it is

  # Two ids can be in play: the one this tab sent, and the one the durable record
  # names. This tab's own live turn wins while it is still live — its send is
  # newer than any projection — and the durable id takes over the moment this tab
  # has no live turn of its own.
  @unit
  Scenario: The turn this tab is streaming is the one Stop targets
    Given this tab sent a turn that has not settled
    And the durable record still names an older turn
    When I click Stop
    Then the stop targets the turn this tab sent

  # Server side: a stop names a turn, and the name is client input. Writing a
  # durable terminal for an arbitrary turn id would let a conversation's owner
  # terminate — or fabricate an answer on — a turn that is not the one running.
  # The turn's own actor is proven by the live-access grant; anyone else has to
  # name the turn the record actually has in flight.
  @unit
  Scenario: A stop naming a turn that is not the one in flight is refused
    Given I own the conversation but did not start its turn
    When I ask to stop a turn the conversation does not have in flight
    Then the request is refused
    And no terminal is recorded against that turn

  # ===========================================================================
  # (2) Continue a stopped chat
  # ===========================================================================

  # A stop leaves the conversation SETTLED and CONTINUABLE — the whole point of
  # modelling it as idle rather than failed. The simplest "continue" is just the
  # next message: nothing is bricked.
  @integration
  Scenario: After stopping, I can just keep chatting
    Given I stopped Langy mid-answer
    When I send another message
    Then the new turn starts normally on the same conversation
    And the stopped partial answer stays in the history above it

  # The richer "continue": pick the abandoned answer back up. Like re-driving a
  # recovered turn (langy-turn-recovery), continue drives a fresh turn WITHOUT
  # re-posting anything — it continues against the conversation already on record,
  # whose history now includes the stopped partial.
  @integration @unimplemented
  Scenario: Continue picks the answer back up without me retyping
    # Tracked: not shipped. There is no Continue affordance anywhere in
    # src/features/langy/**, and no server path that re-drives a stopped turn
    # against the conversation already on record.
    Given a turn I stopped left a partial answer on the conversation
    When I choose Continue on that stopped turn
    Then Langy drives a new turn that continues from where it stopped
    And I did not have to retype or resend my question
    And the conversation holds exactly one copy of my original question

  @unit @unimplemented
  Scenario: Continue is offered only where a turn was stopped
    # Tracked: not shipped. The turn doc carries a `stopped` status, but no
    # surface reads it to offer (or withhold) a Continue control.
    Given a conversation whose last turn completed normally
    Then no Continue affordance is shown for that turn
    Given a conversation whose last turn was stopped
    Then a Continue affordance is shown on that stopped turn

  @integration @unimplemented
  Scenario: Continuing does not spend a second daily pull-request permit for the same intent
    # Tracked: not shipped — depends on Continue existing at all.
    Given a turn that reserved the daily pull-request permit before I stopped it
    When I continue that stopped turn
    Then the continuation does not reserve a second permit for the same intent

  # ===========================================================================
  # (3) Refresh and carry on from where it was streaming
  # ===========================================================================

  # The durable half is already built (ADR-048: "the buffered tail is the resume
  # state"; the server settles a turn whose terminal frame was missed). What was
  # missing is the browser REJOINING on a cold mount. The in-flight turn id lives
  # on the conversation projection, so a reloaded panel can read it and resubscribe.
  @integration @unimplemented
  Scenario: Refreshing mid-answer rejoins the same turn and keeps streaming
    # Tracked: not shipped. The browser never rejoins on a cold mount:
    # `useLangyMessages` exposes only a boolean `isTurnInFlight` (no turn id to
    # resubscribe with) and `useLangyTurnSignals` hardcodes `isCatchingUp:
    # false`. The durable half (buffered tail, server-side settlement) is
    # built; the reattach is not.
    Given Langy is streaming a response to my question
    When I refresh the page
    Then Langy shows it is catching up while it reattaches to the in-flight turn
    And it replays the buffered token tail so no streamed work is lost
    And it keeps streaming the rest of the answer to completion
    And my question is not sent again

  @integration @unimplemented
  Scenario: Refreshing after the turn already finished shows the answer, not a spinner
    # Tracked: the "does not reattach" half is vacuously true because nothing
    # reattaches at all (see the scenario above). Pinning this before the
    # rejoin exists would pin the absence, not the behaviour.
    Given Langy finished answering while the tab was reloading
    When the panel remounts and reads the conversation
    Then the completed answer is shown
    And Langy does not reattach to a turn that is no longer running
    And nothing is left spinning

  @integration @unimplemented
  Scenario: Refreshing after I stopped shows the stopped answer, continuable
    # Tracked: not shipped — needs both the rejoin decision on mount and the
    # Continue affordance.
    Given I stopped a turn and then refreshed the page
    When the panel remounts
    Then the stopped partial answer is shown
    And the Continue affordance is available on it
    And Langy does not reattach to a turn that already terminated

  # The cross-tab consequence of a backend-confirmed stop: a stop in one tab is a
  # real terminal, so a second tab still attached to that turn's stream sees it end
  # — the stream is the shared source of truth, not per-tab UI state.
  @integration @unimplemented
  Scenario: A stop in one tab ends the same turn's stream in another
    # Tracked: the mechanism is shipped (the stop writes an `end` entry to the
    # ONE shared token-buffer stream, and the phase machine settles the second
    # tab off the durable fold), but no test drives two subscribers on one
    # turn, so nothing here would fail if a stop stopped ending the stream.
    Given the same in-flight turn is open in two tabs
    When I stop the turn in one tab
    Then the other tab's live stream ends on the stopped terminal
    And neither tab is left spinning on a turn that is no longer running
