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

  # Provider bodies are untrusted on every surface, including logs: an invalid
  # credential response can quote the credential. The relay therefore extracts
  # only bounded identifier-shaped discriminants from known JSON paths. When
  # there is no code, the HTTP status supplies a stable handled reason and the
  # body contributes only its kind (json, html, text, binary, or empty).
  #
  # See dev/docs/adr/045-domain-errors-handled-boundary.md for the handled-
  # error contract this block follows.
  #
  # Bindings: services/langyagent/adapters/otelrelay/llmproxy_body_test.go

  @unit
  Scenario: Provider JSON discriminants become handled error reasons
    Given a relayed model call is rejected with provider JSON
    When the JSON names a code or type in a known provider dialect
    Then that bounded identifier becomes the reason under "llm_upstream_error"
    And a specific code wins over a broad type
    And no message field enters the handled error or logs

  @unit
  Scenario: Observed upstream response shapes become safe handled errors
    Given the relay receives usage-limit JSON, message-only invalid-model JSON,
      a plain proxy 502, a Cloudflare HTML interstitial, or a binary body
    When it captures the failed model call
    Then each failure has a stable provider or HTTP-derived handled reason
    And its metadata contains only the HTTP status and body kind
    And operators can distinguish the shapes without recording their contents

  @unit
  Scenario: Every upstream HTTP status maps to a stable reason code
    Given a provider rejection carries no identifier-shaped discriminant
    When the relay derives the handled reason from the HTTP status
    Then every client-error and server-error status yields a named reason
    And two failures with the same status always carry the same reason

  @unit
  Scenario: A provider body's shape is classified for safe logging
    Given a provider rejection arrives as JSON, HTML, plain text, binary, or empty
    When the relay classifies the body
    Then the classification records only the kind, never the contents
    And HTML is recognised whether declared by the header or sniffed from the body

  @unit
  Scenario: A stream error with no HTTP status still carries a reason
    Given a model call fails inside a 200 event stream
    When the relay captures the in-stream failure
    Then the capture carries a stable stream-error reason
    And it never leaves the failure without a reason to classify on

  @unit
  Scenario: The gateway's provider header rides into an untyped capture
    Given the gateway names the provider that produced a forwarded rejection
    When the relay captures that rejection as an upstream error
    Then the provider's name is kept in the capture's metadata
    And an operator can tell which provider said no without the body

  # A provider can coincidentally emit the same type/code/message triplet as
  # herr. Shape is not provenance. herr.WriteHTTP marks LangWatch-authored
  # envelopes with a response header whose value must match the body code; the
  # gateway strips that header from every forwarded provider response.
  @unit
  Scenario: Only a marked LangWatch envelope is trusted as a handled error
    Given a provider body looks exactly like a LangWatch handled-error envelope
    When it has no matching LangWatch handled-error response marker
    Then the relay treats it as untrusted provider JSON
    And its message and metadata are discarded
    But a marked LangWatch envelope round-trips losslessly

  # The marker proves who wrote the envelope, not who wrote the sentence
  # inside it: the gateway's own upstream-relay codes carry text derived from
  # the provider's response, so the relay drops their prose while keeping the
  # typed code and reasons.
  @unit
  Scenario: Upstream-relayed prose is scrubbed from marked provider_error envelopes
    Given a marked LangWatch envelope carries a gateway upstream-relay code
    When the relay decodes it as a trusted handled error
    Then its message and tips are dropped before the capture
    And a marked envelope for a gateway-authored rejection keeps its message

  # A chain that exhausted its credentials says so in its own harmless
  # sentence, and holds what each provider actually said one level down, in a
  # per-attempt reason. Scrubbing only the outermost message would keep every
  # sentence that was worth scrubbing.
  @unit
  Scenario: Upstream-relayed prose is scrubbed from nested attempt reasons too
    Given a marked LangWatch envelope wraps per-attempt upstream-relay reasons
    When the relay decodes it as a trusted handled error
    Then every relayed message in the reason chain is dropped, at any depth
    And the typed codes of those reasons survive intact

  # A real envelope can arrive unmarked: an older gateway pod mid-rollout, or
  # a hop that strips the header. Trust stays strict, but the mismatch must be
  # diagnosable rather than a silent downgrade to generic copy.
  @unit
  Scenario: A stripped or mismatched marker on an envelope-shaped body is diagnosable
    Given a rejection body has the exact shape of a LangWatch envelope
    But its marker is absent or names a different code
    When the relay refuses to trust it
    Then a warning records the body's code and the marker's value
    And no message content enters that warning

  @unit
  Scenario: Untrusted provider prose never enters relay logs
    Given a provider rejection contains an API key or other untrusted prose
    When the relay normalizes the rejection as a handled upstream error
    Then its logs contain only the HTTP status, body kind, and bounded reason
    And the provider prose is absent from every log field

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

  # The heartbeat is refreshed only by a frame the worker posts to the control
  # plane, and the key it writes lives ten seconds. A loaded host can swallow
  # that much worker-to-app traffic without anything being wrong, so a lapsed
  # heartbeat on its own says nothing about whether the worker is running. What
  # the turn is still DOING says it. The record kept for reviving a turn ages
  # out well before a long turn ends, so its absence is routine on a long turn:
  # a five-minute answer plus one missed heartbeat window must never be
  # reported to the user as a worker that stopped while the worker is
  # mid-answer.
  @unit
  Scenario: A turn still doing work is not failed because its heartbeat lapsed
    Given a turn whose heartbeat has lapsed but which is still recording activity
    And nothing on hand to revive that turn with
    When the liveness timer fires
    Then the turn is left running and the check is armed again
    And the turn is not failed and not re-dispatched

  @unit
  Scenario: A turn that really stalled with nothing to revive it is failed
    Given a turn whose heartbeat has lapsed and which has recorded no activity for longer than the stall window
    And nothing on hand to revive that turn with
    When the liveness timer fires
    Then the turn fails as a worker that stopped
    And no re-dispatch is attempted

  # The record kept for reviving a turn was given its lifetime once, when the
  # turn was dispatched, and nothing extended it. So a turn that ran longer than
  # that lifetime lost the record while the worker was still working, and there
  # was nothing to revive it with for the rest of the answer. The heartbeat is
  # already the proof that the worker is alive, so it is what extends the
  # record. It extends the lifetime only, because a heartbeat says the worker is
  # alive, not that anything about the turn's resume inputs changed.
  @unit
  Scenario: A heartbeat keeps the turn's revival record alive
    Given a turn that has been running for longer than the revival record lives
    When the worker posts a heartbeat
    Then the revival record is given its full lifetime again
    And the record itself is not rewritten

  @unit
  Scenario: A revival record that already aged out is not recreated
    Given a turn whose revival record has already expired
    When the worker posts a heartbeat
    Then nothing is written back, and the heartbeat still counts as liveness

  @unit
  Scenario: A heartbeat still counts when the revival record cannot be reached
    Given the store holding revival records refuses the request
    When the worker posts a heartbeat
    Then the turn is still marked as alive
    And the frame is not rejected

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
    And the turn fails with the plan-limit card selected by the in-stream reason code

  @unit
  Scenario: A clean stream clears the in-stream failure capture
    Given a conversation's relayed call previously ended with an in-stream error event
    When a later relayed call streams to completion without an error event
    Then the capture is cleared and later calls pass through untouched

  # The gateway can also forward an upstream rejection as a 200 whose
  # Content-Type says event-stream but whose body is ONE bare JSON error
  # object, with no event framing at all (seen live: Anthropic rejecting a
  # request parameter). A sniffer that only reads framed events sees nothing,
  # and the clean-end rule then CLEARS the capture, so the turn fails with no
  # cause on record.
  @unit
  Scenario: A bare JSON error body under a stream content type is captured as the cause
    Given the model provider rejects a relayed call
    And the gateway forwards the rejection as a 200 stream whose body is one bare JSON error object
    When the agent's SDK reads that body to its end
    Then the rejection's reason code is captured as the turn's LLM cause
    And the provider's own prose stays out of the capture

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
