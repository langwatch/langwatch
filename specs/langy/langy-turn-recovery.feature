Feature: Langy recovers from a failed turn without making the user re-ask
  As someone mid-conversation with Langy when a deploy, a timeout, or a busy
  agent kills the turn,
  I want Langy to quietly pick itself back up,
  so that a transient infrastructure hiccup does not cost me my question.

  # A turn failure arrives on the chat stream as a TYPED domain error
  # (langy_worker_restarting, langy_turn_timeout, langy_agent_unavailable,
  # langy_agent_at_capacity, langy_agent_session_lost, unknown). Because the
  # failures are typed, they can be HANDLED: a recovery policy keyed on the
  # kind decides whether to retry, how long to wait, how many times, and what
  # to say while it happens. Only when the policy gives up does the red error
  # card with its manual "Try again" appear.
  #
  # The retry re-drives the TURN. It never re-posts the user's message: the
  # message was already persisted before the turn ran, so re-sending it would
  # append a second copy of the same question to the conversation.

  @unit
  Scenario: A deploy interrupts the turn and Langy picks it back up
    Given Langy is answering a question
    When the worker restarts mid-answer and the turn fails
    Then the user does not see a red error card
    And Langy shows a quiet line saying it restarted and is picking up where it left off
    And Langy re-drives the turn on its own
    And the user's question appears in the conversation exactly once

  @unit
  Scenario: A busy agent is retried with a countdown, not an error
    Given every Langy worker slot is taken
    When the turn fails because Langy is at capacity
    Then Langy shows a quiet line saying it is busy and counting down to the retry
    And Langy waits longer before each further attempt
    And Langy gives up to an error card once its attempts are exhausted

  @unit
  Scenario: A lost session is terminal and is never retried
    Given Langy lost the session backing this conversation
    When the turn fails
    Then Langy shows the error card immediately
    And Langy does not retry, because a retry would hit the same wall

  # When the worker STOPPED — its process died mid-reply, or the liveness sweep
  # re-dispatched it and it still never came back — the control plane has already
  # exhausted its own recovery. Re-driving from the browser only walks into the
  # same dead worker, which is what produced the flicker the user hated: a card
  # that flashed, vanished into a silent retry, and came back minutes later. So
  # "the worker stopped" is a FINAL state with its own specific copy, not an
  # auto-retry. Nothing was lost — the user's message is on record — so the card
  # offers a manual "Try again", but Langy does not re-drive on its own.
  @unit
  Scenario: The worker stops mid-reply and Langy shows a final, specific error
    Given Langy is answering a question
    When the worker stops before finishing and the turn fails
    Then Langy shows a card that says its worker stopped, specifically
    And the card offers a manual retry
    And Langy does not re-drive the turn on its own
    And the card never flickers away into a silent retry

  # A model call rejected upstream carries the provider's own explanation — an
  # out-of-credits account, a model the plan does not include. That text is
  # provider-facing (the same body the playground shows), and hiding it behind
  # "Something went wrong" leaves the one actionable sentence unread. The
  # manager's LLM proxy captures the provider's message off every failed
  # mediated call (typed gateway envelope or provider-native body alike) and it
  # rides the turn's error as a reason, so the card can say it. Bound by
  # langyErrorExplainer.unit.test.ts (provider-message cases).
  @unit
  Scenario: A rejected model call shows the provider's own message on the card
    Given Langy's model call is rejected by the provider
    When the turn fails and the error reaches the panel
    Then the card keeps the friendly reply-failed framing
    And it includes the provider's own error message
    And it suggests trying again or picking a different model
    But when no provider message was captured, the stock reply-failed copy stands

  # The flicker had a second cause independent of the worker-stopped loop: for the
  # kinds that DO auto-retry, the red card rendered for a single frame before the
  # retry timer armed. The card must not appear at all when an automatic retry is
  # about to run — recovering beats failing from the very first paint.
  @unit
  Scenario: An about-to-retry failure never flashes the error card
    Given a turn failed with a kind Langy auto-retries
    When the failure first reaches the panel
    Then the error card does not render, not even for one frame
    And the calm recovering line is what the user sees

  @unit
  Scenario: An unrecognised failure is never retried
    Given the turn fails with a kind Langy does not recognise
    When the failure reaches the panel
    Then Langy shows the error card immediately
    And Langy does not retry, because it cannot know what it is retrying into

  # A missing prerequisite is NOT a failure and NOT a dead end. "Do not retry"
  # here means something completely different from "give up": no amount of
  # backing off connects someone's GitHub account, but there is a perfectly good
  # next action and the UI's job is to offer it where the turn stopped. Painting
  # this red would be the product blaming the user for not having finished
  # onboarding.
  #
  # Crucially, Langy works this out by WATCHING WHAT THE AGENT RUNS, not by
  # asking the agent to say so. The old design told the model to print a marker
  # into its reply and then regexed the reply to draw the card — an LLM asked to
  # be a reliable state machine in prose. It could forget, paraphrase, or say it
  # on a turn that never touched GitHub. We can see it run `gh`.
  @unit
  Scenario: Langy reaches for GitHub and the user has not connected it
    Given the user has not connected their GitHub account
    When Langy runs a command that needs GitHub
    Then the turn stops
    And the user does not see a red error card
    And Langy offers a Connect button in the conversation, where the turn stopped
    And Langy does not retry on its own, because only the user can connect it
    And the stalled turn gives back the daily pull-request permit it reserved

  # The false-positive guard, and the reason this is not a blanket pre-flight:
  # most turns never touch GitHub, and stopping them all to demand a connection
  # would break every other request.
  @unit
  Scenario: A turn that never needs GitHub is untouched
    Given the user has not connected their GitHub account
    When Langy answers a question that needs no GitHub access
    Then the turn completes normally
    And the user is never asked to connect anything

  @unit
  Scenario: Local git work does not demand a GitHub account
    Given the user has not connected their GitHub account
    When Langy makes a local commit but never talks to the remote
    Then the turn completes normally
    And the user is never asked to connect anything

  @integration
  Scenario: Connecting GitHub resumes the turn without a duplicate message
    Given a turn stopped because GitHub was not connected
    When the user connects their GitHub account from the card
    Then Langy re-drives the turn without the user retyping anything
    And the conversation holds exactly one copy of the user's message
    And the resumed turn does not consume a second daily pull-request permit
    And the resumed turn runs with the GitHub token in place

  @unit
  Scenario: A turn that already changed something is not silently replayed
    Given Langy already ran a tool that changes the project during this turn
    When the turn then fails with an otherwise-recoverable error
    Then Langy does not retry automatically
    And the user is offered the error card, so the replay is their decision

  @integration
  Scenario: A retry re-drives the turn instead of re-posting the message
    Given a Langy turn failed after the user's message was persisted
    When the turn is retried, automatically or from the error card
    Then the conversation holds exactly one copy of the user's message
    And the retried turn runs against the message already on record

  # ---------------------------------------------------------------------------
  # The control plane must never fail a turn that already finished
  # ---------------------------------------------------------------------------

  # The liveness timer's queue payload captures the conversation state at the
  # moment it is armed — in that snapshot the turn is ALWAYS still in flight.
  # Deciding on the snapshot meant every quiet-but-successful turn was
  # re-dispatched and then terminally failed AFTER its answer had landed.
  @unit
  Scenario: The liveness timer stands down when the turn already completed
    Given a turn completed and its answer is on record
    When the liveness timer for that turn fires late
    Then it re-reads the conversation's current state, not its armed snapshot
    And it sees no turn in flight and does nothing

  @unit
  Scenario: The liveness timer stands down when a newer turn superseded the armed one
    Given the armed turn was superseded by a newer turn
    When the liveness timer fires
    Then it does not touch the newer turn and does not fail the old one

  @unit
  Scenario: A late failure never overwrites a completed answer
    Given a turn completed and the conversation is idle
    When a stale failure for that turn still reaches the conversation
    Then the conversation stays idle with its answer intact
    And no error is recorded over the completed turn

  @unit
  Scenario: A turn reaches exactly one terminal, first writer wins
    Given a turn's completion and a stale failure race each other
    When both try to terminate the same turn
    Then only the first terminal is recorded
    And the second is collapsed as a duplicate, like a tool call's terminals
