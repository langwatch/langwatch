Feature: Langy can run a conversation on the pi harness
  Langy's worker runs on one of two coding-agent harnesses, selected per
  project. The harness rides the same credential envelope as every other
  worker-shaping input, so a change replaces the worker instead of quietly
  reusing one built for the other harness, and a deploy that introduces
  harness selection does not touch any worker that was running before it.

  # Companion specs:
  #   - specs/langy/langy-minimal-harness.feature  (what the worker's prompt and
  #     tool surface look like, harness-independent)
  #   - specs/langy/langy-stop-and-resume.feature  (the user-facing stop this
  #     feature's cancel path completes)

  @unit
  Scenario: A conversation that names no harness keeps its running worker
    Given a worker is running for a conversation that never named a harness
    When the next turn arrives naming the default harness explicitly
    Then the running worker is reused
    And no worker is replaced just because harness selection was deployed

  @unit
  Scenario: Selecting the pi harness replaces the conversation's worker
    Given a worker is running for a conversation on the default harness
    When the next turn arrives selecting the pi harness
    Then the running worker does not match and is replaced
    And the conversation continues on a worker built for the pi harness

  @unit
  Scenario: An unrecognized harness value falls back to the default harness
    Given a turn arrives naming a harness this manager does not know
    When the manager resolves the harness
    Then the turn runs on the default harness
    And the unknown value never selects an unfinished or absent harness

  @unit
  Scenario: The pre-turn probe answers for the harness the turn will use
    Given the control plane asks whether a matching worker is already running
    When the probe names the harness the turn would run on
    Then the answer compares the running worker's harness too
    And a harness change is a miss, so the turn replaces the worker instead of reusing it

  # The wrapper generates pi's model registry from the manager's config. That
  # entry must not LOSE what pi's own catalog knows about the model: Claude 5
  # models need the adaptive thinking request shape, which pi selects from its
  # catalog's compat flags, so a registry built from the manager's config alone
  # sent the legacy shape and every turn on those models failed on the first
  # call.
  @unit
  Scenario: A known model's registry entry keeps pi's own catalog knowledge
    Given the manager configures a model pi's own catalog lists for the same API dialect
    When the wrapper generates the model registry
    Then the entry carries the catalog's request-shape flags and thinking levels
    And the manager's explicit settings win over the catalog where both name the same field
    And the entry still routes through the mediated gateway URL, never the catalog's own endpoint

  @unit
  Scenario: A model pi's catalog does not know is written from config alone
    Given the manager configures a model id pi's catalog does not list for that API dialect
    When the wrapper generates the model registry
    Then the entry is exactly the manager's config

  # The model config passes unknown keys through so a new compat flag needs no
  # wrapper change. Routing and credential keys must not travel that path: they
  # decide where the request goes and what authenticates it, and the whole point
  # of the mediated gateway is that the worker cannot choose either.
  @unit
  Scenario: A model entry cannot carry its own endpoint or credential
    Given the manager's model config carries a base URL, a provider name or an API key
    When the wrapper generates the model registry
    Then those keys are dropped from the model entry
    And the registry still routes through the gateway URL the environment names
    And the key travels as an environment reference, so no secret is written to disk

  @unit
  Scenario: A cancel reaches the worker running the named turn
    Given a worker is running a turn the user asked to stop
    When the manager receives the cancel for that conversation and turn
    Then the worker is told to abort exactly that turn
    And the generation stops burning tokens

  @unit
  Scenario: A cancel naming a turn that is not running changes nothing
    Given a worker is running a turn
    When a cancel arrives naming a different turn, or a conversation with no worker
    Then nothing is aborted
    And the running turn continues untouched

  # Posting a turn and consuming its events are started in that order but are
  # not ordered against each other, so a turn abandoned between the two leaves
  # its events with no reader. The next turn on the same worker must not inherit
  # it: reading the dead turn's events means the live turn's own events pile up
  # unread, and once that backlog is full the worker stops answering at all.
  @unit
  Scenario: An abandoned pi turn cannot capture the next turn's stream
    Given a turn was posted and then abandoned before anything read its events
    When the next turn on that worker starts
    Then it reads its own events, not the abandoned turn's
    And the abandoned turn's events are released instead of waiting forever

  # The relay carries ephemeral frames the durable log can survive without, so
  # a broken push must degrade the live view, never end the turn: ending it
  # releases the worker mid tool call and the idle reaper kills it while an
  # LLM call is still in flight.
  @unit
  Scenario: A broken relay push never fails the turn
    Given the relay stream to the control plane breaks mid-turn
    When the next frame push fails
    Then the sink reopens the stream and retries the frame once
    And repeated reopen failures drop frames under a cooldown instead of erroring
    And the turn keeps running to its real terminal

  @unit
  Scenario: A command to a worker that stopped reading gives up instead of blocking
    Given a worker has stopped reading the commands the manager sends it
    When the manager sends a command, a cancel among them
    Then the send gives up within its deadline
    And later commands are refused rather than appended to a half-written one
    And the conversation's other calls are not held up behind it

  # The session storage lives OUTSIDE the worker home, in a per-conversation
  # store the manager keeps. The home is wiped on every worker death (idle
  # reap, eviction, model switch, crash), and when the session lived inside
  # it, every respawn started fresh: the whole transcript was re-seeded as one
  # folded block, which both re-read the conversation at full input price and
  # rewrote the provider's prompt-cache prefix. Resuming the persisted session
  # rebuilds the same messages, so the provider's cached prefix still matches.
  # The transcript seed remains the fallback for a session store that is
  # genuinely gone (manager restart, the staleness sweep).
  @unit
  Scenario: A respawned pi worker resumes the conversation's persisted session
    Given a persisted session with at least one completed turn
    When the worker respawns for that conversation
    Then it continues that session instead of starting fresh
    And it announces the resume on its ready handshake, so the manager skips the transcript seed

  @unit
  Scenario: The session store survives the worker's teardown
    Given a conversation with a persisted session and a live worker
    When the worker dies and its home is wiped
    Then the session store is untouched

  @unit
  Scenario: A respawned worker can read the previous worker's session files
    Given a persisted session written by a worker that ran under another identity
    When a fresh worker is provisioned for the conversation
    Then every session file is owned by the fresh worker's identity

  # The stash parent is shared by every conversation and stays owned by the
  # manager. A sandboxed worker runs under its own per-conversation identity
  # and must pass through the stash to reach its own store. A stash without
  # that traversal permission killed every pi worker at boot in production:
  # the wrapper died on a permission error before its ready handshake, every
  # first message failed with worker_spawn_failed, and the panel hung on
  # "Thinking" and then "Reconnecting to the agent". The local runner (one
  # identity for manager and worker) can never see this, which is why it
  # shipped: the traversal bit is the sandbox-only contract this pins.
  @unit
  Scenario: A sandboxed worker can enter the shared session stash
    Given workers run under per-conversation identities
    When a worker's session store is provisioned
    Then the shared stash directory lets a worker pass through it
    And the stash stays unlistable, so sibling conversation ids stay hidden
    And a stash created earlier with a stricter mode is repaired on provision

  # Conversation content must not sit on the manager's disk indefinitely
  # after the user moved on; a day covers every cache tier the store serves.
  @unit
  Scenario: A quiet conversation's session store is swept after a day
    Given a persisted session whose conversation has no worker and no recent writes
    When the sweep runs
    Then that session store is removed
    And a session with recent writes or a live worker is kept

  # Provider prompt caching is what makes a long conversation affordable, and
  # the default cache tier expires faster than the pauses between a user's
  # messages. The worker asks for the long tier: anthropic's hour-long
  # cache_control, the Responses lane's day-long retention. The codex lane is
  # the exception: the ChatGPT backend rejects the retention parameter with a
  # 400 (the API-key endpoint accepts it), and in production that 400 killed
  # every codex turn on its first LLM call. So the codex lane never asks.
  @unit
  Scenario: The worker asks the provider for long cache retention
    Given a pi worker provisioned for an anthropic or openai model
    When its config and environment are assembled
    Then the model allows long cache retention and the environment selects it
    But a codex model never asks for it, because its backend refuses the request

  @unit
  Scenario: A corrupt persisted session degrades to a fresh one instead of failing the spawn
    Given the home's persisted session file cannot be read
    When the worker respawns in that home
    Then it starts a fresh session and reports no resume
    And the spawn itself never fails over the corrupt file

  @unit
  Scenario: A resumed session ignores the handoff digest it no longer needs
    Given a worker resumed the session its home still held
    When a turn arrives carrying a shutdown-handoff digest
    Then the digest is not folded into the prompt
    And the session's own history remains the single copy of the conversation

  # Telemetry: the pi harness exports no OTLP of its own, so the relay retells
  # each mediated LLM call as one gen_ai span. Provider prompt caching serves
  # most of a follow-up's prompt at a fraction of the input price, and a retold
  # span without the cache breakdown reads as a full-price call. See also
  # specs/ai-gateway/cache-token-telemetry.feature for the gateway span, which
  # stays the meter; the retold copy is descriptive.
  @unit
  Scenario: The retold LLM span carries the provider's cached-token usage
    Given a pi worker's mediated LLM call whose response reports cached-token usage
    When the relay retells the call as a gen_ai span
    Then the span carries the cache-read and cache-write token counts
    And the hour-long share of the writes when the provider states it
    And the counts use the same attribute names the gateway's own span uses
