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

  # A rejected model call comes back with the provider's own explanation, and
  # the card used to recite it: an out-of-credits account is a real fix that
  # "Something went wrong" hides. It cost too much. A provider's error body is
  # written for whoever holds the API key, and on a mediated call that is
  # LangWatch — a rejected key comes back quoted inside that sentence, so the
  # card was printing a platform credential to a customer. Masking it first is
  # not a fix: matching credential shapes only catches the shapes enumerated.
  @unit
  Scenario: A rejected model call never recites the provider's own message
    Given Langy's model call is rejected by the provider
    When the turn fails and the error reaches the panel
    Then the card keeps the friendly reply-failed framing
    And the provider's own sentence appears nowhere on it
    And it suggests trying again or picking a different model

  # Nothing actionable is lost, because the part a customer could act on was
  # never the prose — it was which failure it was. The provider says that in a
  # discriminant, a value from a set it enumerates, which cannot carry a key.
  @unit
  Scenario: An out-of-allowance model call is promoted by reason code, not by message
    Given Langy's model call is rejected because the account has no allowance left
      # "usage_limit_reached", "codex_plan_limit", "insufficient_quota" or
      # "billing_hard_limit_reached", depending on which backend answered
    When the turn fails and the error reaches the panel
    Then the failure is promoted to the plan-limit card by its reason code
    And the customer reads copy written by LangWatch for that case
    And the provider's own sentence still appears nowhere

  # Keeping the prose out of the customer's card put all of it on the operator
  # log line, which makes what the log keeps load-bearing. It kept less than it
  # looked: the probe read three known dialects and, failing those, discarded
  # any body that started with a brace, so an unrecognised JSON shape left the
  # line holding a byte count and nothing else. Five turns failed with no
  # recoverable cause at all.
  #
  # Bindings: services/langyagent/adapters/otelrelay/llmproxy_test.go

  @unit
  Scenario: A failure in a shape nobody parsed still leaves the operator something to read
    Given a relayed model call is rejected with an error body in no dialect the relay knows
    When the relay records the failure for operators
    Then the body itself is recorded, bounded, under a field that says nobody parsed it
    And it is never confused with a provider message the relay did recognise

  # A proxied call answered by a Cloudflare Access login page was 41 kilobytes
  # of HTML. Bounding that to the usual couple of thousand characters records
  # two thousand characters of stylesheet, so an interstitial contributes its
  # title and nothing more: with the status, that is the whole diagnosis.
  @unit
  Scenario: A login page standing in for the API is recorded as a login page
    Given a relayed model call is answered with an HTML page instead of an API response
    When the relay records the failure for operators
    Then the page's title and the status are recorded
    And none of the page's markup is

  @unit
  Scenario: A provider message the relay knows is still recorded as one
    Given a relayed model call is rejected in a dialect the relay knows
    When the relay records the failure for operators
    Then the provider's own sentence is recorded as the upstream message, as before

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

  # A provider rate limit is retryable by every SDK's book, and for a burst
  # (tokens-per-minute) that is right: back off a little and the call lands.
  # But a PLAN limit ("usage limit reached until next week") answers every
  # retry identically, and the coding agent's ever-growing backoff turns that
  # into an hours-long silent spinner: the turn never fails, so the plan-limit
  # card the panel already knows how to draw never gets its chance. The relay
  # sits between the agent and the gateway and is the one place that sees every
  # rejected call, so it is the one that ends the loop: it converts the hard
  # rate limit into a failure the agent's SDK treats as final, keeping the
  # provider's own body so the turn's error frame still names the real cause.

  @unit
  Scenario: A provider that says its usage limit is reached fails the turn at once
    Given the model provider rejects a relayed call with a rate limit that names its usage limit as reached
    When the relay answers the coding agent
    Then the answer is a failure the agent's SDK does not retry
    And it carries the provider's own error body unchanged
    And the turn fails with the plan-limit explanation instead of spinning

  @unit
  Scenario: A rate-limit burst keeps its normal retries, then is cut
    Given the model provider rate-limits relayed calls without naming a deterministic limit
    When the same conversation's calls keep being rate-limited without interruption
    Then the first two rejections pass through for the SDK's own backoff
    And the third uninterrupted rejection becomes a failure the SDK does not retry
    But any other answer in between, a success or a different error, starts the count over

  @unit
  Scenario: A rate-limited conversation never blocks a healthy one
    Given one conversation has been cut off at a hard rate limit
    When a different conversation's calls are relayed
    Then they pass through untouched with their own fresh count

  # A provider can also fail AFTER answering 200: the stream opens, then an
  # in-stream error event (OpenAI's insufficient_quota) ends it. Status-based
  # cutting never sees these, every retry re-opens a fresh 200 stream and
  # dies the same way, the same silent spinner with a different door.

  @unit
  Scenario: A hard limit delivered inside a 200 stream is cut like a rejected call
    Given the model provider opens a 200 stream on a relayed call
    And ends it with an in-stream error event naming exhausted quota
    When the agent's SDK retries the call
    Then the relay answers the retry with a failure the SDK does not retry
    And it carries the provider's own error payload
    And the turn fails with the provider's message instead of spinning

  @unit
  Scenario: A clean stream clears the in-stream failure capture
    Given a conversation's relayed call previously ended with an in-stream error event
    When a later relayed call streams to completion without an error event
    Then the capture is cleared and later calls pass through untouched

  # The turn stream's terminal error entry shares its `type: "error"`
  # discriminant with the SSE transport's own protocol failure frame. The
  # transport once claimed every such frame for itself, so the one entry that
  # names the real failure killed the subscription instead: watching a turn
  # fail LIVE showed the generic unknown card, while reloading the same
  # conversation showed the correct one from the durable record. The live road
  # and the reload road must end at the same card.
  @unit
  Scenario: A live-watched failure shows the same card a reload shows
    Given the user is watching Langy answer when the turn fails
    When the failure reaches the open conversation
    Then the user sees the card that names what actually went wrong
    And it is the same card a reload of the conversation would show
    And the generic something-went-wrong card never appears in its place

  @unit
  Scenario: A genuinely dead stream still names the durable failure
    Given the live connection drops before Langy can say what went wrong
    When the turn's failure is already on the conversation's record
    Then the user sees the card naming that recorded failure, not a generic apology
