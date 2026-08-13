Feature: haven answers an agent's tool call before it runs
  As a developer running around ten agents that cannot see each other
  I want each one's expensive commands to pass through one machine-wide gate
  So that they queue against each other instead of landing together, without haven
  ever having to drive or even know about the agents themselves

  # `haven gate` is a Claude Code hook. The direction of control is the point:
  # the agent calls haven, haven answers, haven never invokes the agent. It
  # fires inside sub-agents too. See ADR-091.
  #
  # Properties of the hook contract, MEASURED against a headless session with a
  # scratch settings file rather than read from docs:
  #   - the matcher shape works: a hooks.PreToolUse[] entry with matcher "Bash"
  #     and a hooks[] array of {type: command, command, timeout} fires;
  #   - the payload carries session_id, transcript_path, cwd, prompt_id,
  #     permission_mode, effort.level, hook_event_name, tool_name, tool_input
  #     and tool_use_id — and NO agent_id in a main session, which turns out to
  #     be the load-bearing field: a scan of 40 transcripts (14,121 requests,
  #     ~53M cache-write tokens) shows sub-agents write ephemeral_5m 100% of the
  #     time and main sessions write ephemeral_1h 100% of the time, with no
  #     request writing both. So agent_id says which cache floor the caller has;
  #   - `updatedInput` is honoured with `allow` and SILENTLY IGNORED with
  #     `defer`. The same hook returning the same replacement rewrote and ran
  #     the command under allow, and left the original untouched under defer;
  #   - EXIT CODE 2 IS THE ONE CODE THAT BLOCKS, and a compiled Go panic exits
  #     with exactly 2, so the language's crash default is a machine-wide
  #     tool-call blocker. (`go run` masks this — it exits 1 itself.)
  #   - it otherwise FAILS OPEN: a timeout, or any other non-zero exit, lets
  #     the command proceed.
  #
  # THE REWRAP, AND WHY IT REACHES LESS FAR THAN IT LOOKS. The hook exits before
  # the command runs, so it cannot hold a slot for the command's lifetime;
  # rewriting the command so haven's own process holds the flock avoids a lease,
  # a TTL and a reaper. But rewriting needs `allow`, and allow BYPASSES the
  # permission system — so the gate may only rewrite where permission_mode
  # already auto-approves. Under `default` or `plan` it observes and may refuse,
  # but does not rewrite. That is the honest reach: unattended fleets run
  # auto-approving and are the case this exists for; an interactive session
  # keeps its prompts.
  #
  # tool_input.command is a SHELL STRING, not argv, so the original is passed as
  # one escaped argument rather than spliced after a separator.
  #
  # Two contract details remain UNVERIFIED: whether `/model` raises a hook at
  # all, and where CLAUDE.md sits in the cached prefix.

  # --- The fast path is almost everything ---

  @unit
  Scenario: A command that is not heavy is waved through
    Given a tool call that is not a heavy command
    When the gate is asked about it
    Then it defers to the normal permission flow
    And the admission half does no work beyond reading one cached pressure file
    # Scoped deliberately to admission: the repeat detector in
    # specs/claude/llm-cost-safety.feature must record something per call, so
    # "no work" cannot hold for the gate as a whole.

  @unit
  Scenario: Only a named set of commands is treated as heavy
    When the gate classifies a command
    Then vitest, tsgo, biome, next build, go build and docker build are heavy
    And everything else defers, because gating ordinary commands would be its own outage

  @unit @unimplemented
  Scenario: The gate answers within its own budget
    When the gate answers any tool call
    Then it returns within a stated millisecond budget
    And it never waits for a slot itself, because waiting is the wrapped command's job

  # --- The rewrap ---

  @unit
  Scenario: A heavy command is passed to haven as one escaped argument
    Given a heavy command under pressure
    When the gate rewrites it
    Then the original command is passed as a single escaped argument for a shell to run
    And it is not spliced after a separator, because the command is a shell string and not argv

  @unit
  Scenario: A command containing shell operators is gated as a whole
    Given a heavy command joined to another command by a shell operator
    When it is rewritten
    Then the whole line runs under the slot
    And no part of it escapes the slot by being parsed at the outer level

  @unit
  Scenario: A command already under haven's heavy class is not rewrapped again
    Given a command that is already wrapped
    When the gate is asked about it
    Then it is left alone
    Because a nested wrap makes the outer hold the slot the inner waits for

  @unit
  Scenario: The rewrap names haven by absolute path
    Given haven is not on the caller's PATH
    When a command is rewritten
    Then the rewritten command still runs
    Because installing haven onto PATH is optional, and a rewrite that fails has broken a working command

  @unit
  Scenario: The rewrap carries the decision it was given
    Given the gate has resolved who is calling and how the run should be admitted
    When it rewrites the command
    Then the rewritten command names the calling agent
    And it names the worker count the run was admitted at, when it was narrowed
    Because the wrapped run otherwise re-derives all of it from an empty command line,
    So every sub-agent takes the main-session ceiling and a narrowing never happens

  @unit @unimplemented
  Scenario: A rewrapped run is admitted once, not twice
    Given a rewritten command whose inner package script also routes through the shared counter
    When it runs
    Then it holds exactly one slot

  @unit @unimplemented
  Scenario: A rewritten command explains itself
    Given a command the gate has rewritten
    When the replacement is handed back
    Then it carries a description saying haven queued the command and why
    # Measured: a model whose command was silently substituted ran it, noticed
    # the output did not match what it asked for, and reported the environment
    # as untrustworthy. An unexplained rewrite makes an agent doubt its own
    # tools, which is worse than a slow test run.

  # --- Permission boundaries are not the gate's to move ---

  @unit @unimplemented
  Scenario: A session that already auto-approves may be rewritten
    Given a session whose permission mode already auto-approves tool calls
    When a heavy command is gated under pressure
    Then it is rewritten and approved
    Because the approval grants nothing the session was not already granting

  @unit @unimplemented
  Scenario: A session that still prompts is never rewritten
    Given a session whose permission mode would prompt for this command
    When a heavy command is gated under pressure
    Then the command is left untouched and the permission flow is left alone
    Because rewriting requires an approval, and a resource governor must not hand one out

  @unit @unimplemented
  Scenario: A rewrite the gate declines to make is still observed
    Given a session whose permission mode would prompt for this command
    And pressure is red with no slot free
    When the command is gated
    Then it may still be refused
    Because refusing takes nothing away from the user, and approving would

  # --- The ladder ---

  @unit @unimplemented
  Scenario: On an unloaded machine a heavy command is untouched
    Given pressure is green and a slot is free
    When a heavy command is gated
    Then it is deferred unchanged

  @unit @unimplemented
  Scenario: A main-session command with no slot free is rewritten to queue
    Given pressure is amber and no slot is free
    And the payload carries no agent id, so the caller is a main session
    When it is gated
    Then it is rewritten to queue at full width
    Because a main session holds the one-hour cache, so the wait costs nothing and a queued run holds no memory

  @unit @unimplemented
  Scenario: A short sub-agent command is narrowed instead
    Given pressure is amber and no slot is free
    And the payload carries an agent id, so the caller holds the five-minute cache
    And the command is projected to finish inside five minutes
    When it is gated
    Then it is rewritten to run under haven's heavy class with a smaller worker count

  @unit @unimplemented
  Scenario: The caller's cache floor is read from the payload, not inferred
    When the gate decides which ceiling applies
    Then the presence of an agent id decides it
    And no transcript is parsed to work it out

  # MEASURED: updatedInput can set run_in_background on a Bash call. A probe
  # confirmed the agent then gets control back immediately, reads haven's
  # explanation out of the replacement description, and receives a completion
  # notification with the exit code when the run finishes. That is the closest
  # thing to a push channel there is — hooks are request/response, and a blocked
  # agent makes no API calls, so there is nothing to push to.
  @unit
  Scenario: A wait too long to serve is backgrounded rather than refused
    Given no slot is free
    And the queue is deeper than this caller's wait ceiling
    When a heavy command is gated
    Then it is handed back to run in the background
    And the agent keeps working rather than waiting or retrying
    Because it was not going to get its result this turn either way

  @unit
  Scenario: A backgrounded run explains itself in the same breath
    Given a command the gate has backgrounded
    When the replacement is handed back
    Then its description says haven queued it and that it is running in the background
    So the agent does not read an immediate return as an immediate result

  @unit @unimplemented
  Scenario: A queued run reports its position while it waits
    Given a backgrounded run still waiting for a slot
    When the agent polls the background task
    Then it sees the current queue position rather than silence

  @unit
  Scenario: A wait that fits the ceiling still blocks
    Given no slot is free
    And the queue is shallower than this caller's wait ceiling
    When a heavy command is gated
    Then it queues inline and the call blocks as normal
    Because backgrounding breaks causality, and is only worth that where the alternative was a refusal

  @unit @unimplemented
  Scenario: At critical pressure with no slot free the command is refused
    Given pressure is red and no slot is free
    When a heavy command is gated
    Then it is denied at once, and not backgrounded
    Because at red the machine cannot take the work at all, so deferring it only moves the burst

  @unit @unimplemented
  Scenario: The tool timeout is raised by the wait, not capped at the floor
    Given a command rewritten to run under haven's heavy class
    When the replacement input is built
    Then the tool timeout is raised by the admission wait the run may incur
    And the wait itself is bounded by whichever ceiling that session's cache lifetime earns
    But the command's own runtime is not capped by that ceiling, or a long suite would be killed

  # --- The refusal has to be actionable ---

  @unit
  Scenario: A refusal explains the state in terms the caller can act on
    When the gate denies a heavy command
    Then the reason names the current pressure and how many runs are queued
    And it names work that is safe to do instead

  @unit
  Scenario: A refusal says where the caller is in the queue and when to come back
    Given a refused command whose queue depth can be estimated
    When the reason is written
    Then it gives the caller's position and a time to try again
    And the time leads, because it is what decides what the caller does next

  # The cap is the invariant the whole idea rests on. The wait ceiling already
  # sits under the caller's prompt-cache floor, so a time quoted inside the
  # ceiling is always a time the caller can afford to honour.
  @unit @unimplemented
  Scenario: A quoted retry time is never later than the caller's cache window
    Given a refused command
    When a retry time is quoted
    Then it is inside the cache window that caller is in

  @unit @unimplemented
  Scenario: A queue too deep to quote honestly is backgrounded instead
    Given a queue deeper than the caller's cache window
    When the command is gated
    Then no retry time is quoted
    And the run is handed back to run in the background
    Because sending a caller away past its own window is a comfortable lie

  @unit @unimplemented
  Scenario: A command with nothing observed gets no invented estimate
    Given a command haven has never timed
    When it is refused
    Then no retry time is quoted
    And the refusal says so rather than guessing

  # This counter is what decides whether haven ever HOLDS a caller's place
  # rather than just describing it. Holding it fixes starvation and costs a
  # store, an expiry, a reclaim, and a client that cooperates — so it is
  # measured before it is built.
  @unit @unimplemented
  Scenario: Repeated refusals of the same command are counted
    Given the same command refused several times in a row
    When the doctor reports
    Then it names that command as starving
    And one or two refusals are reported as ordinary contention, not starvation

  @unit
  Scenario: A refusal never invites the caller to sleep or poll
    When the gate denies a heavy command
    Then the reason explicitly tells the caller not to sleep, poll or wait for it
    Because sleeping buys nothing the queue would not have given, and for a
    sub-agent it also loses the five-minute cache the refusal was protecting

  @unit @unimplemented
  Scenario: The same command is not refused indefinitely
    Given a command that has been denied repeatedly
    When it is gated again past the retry threshold
    Then it is admitted or queued rather than denied again
    Because a deny-and-retry cycle costs a turn each time and eventually exceeds the bust it avoids

  # --- Fan-out ---

  @unit @unimplemented
  Scenario: Spawning past the machine-wide agent cap is refused
    Given the machine-wide limit on concurrent sub-agents is already reached
    When another sub-agent spawn is gated
    Then it is denied
    And the reason says how many are already running

  @unit @unimplemented
  Scenario: The spawn count is decremented when a sub-agent ends
    Given a sub-agent that has finished
    Then the machine-wide count no longer includes it

  @unit @unimplemented
  Scenario: A spawn count that cannot be trusted admits
    Given counted spawns that have outlived their expiry
    When a spawn is gated
    Then those entries are discarded and the spawn is admitted
    Because a stale count would otherwise refuse every spawn on the machine forever

  @unit @unimplemented
  Scenario: An agent that holds no slot is preferred over one that holds several
    Given one agent already holds a heavy slot and another holds none
    And both are waiting
    When a slot frees
    Then the agent holding none is admitted first
    # Requires the caller's identity to reach the wrapped run — agent_id inside
    # a sub-agent, session_id in a main session — and an ordering the plain
    # polling flock in adapters/semaphore does not itself provide.

  # --- Nothing here may wedge an agent ---

  @unit
  Scenario: A malformed payload defers
    Given the gate is handed input it cannot parse
    Then it defers and exits without blocking

  @unit @unimplemented
  Scenario: An unreadable state directory defers
    Given the gate's own state directory cannot be read
    Then it defers and exits without blocking

  @unit @unimplemented
  Scenario: A crash inside the gate defers rather than blocking
    Given the gate panics while deciding
    Then it does not exit with the status that blocks a tool call
    And the tool call proceeds
    Because an unrecovered panic exits with exactly that status by default

  # --- Installing the hook, which edits a file haven does not own ---
  #
  # The gate only runs if Claude Code is told about it, and telling it means
  # writing settings in the developer's checkout. It is opt-in — `haven setup
  # gate-hook`, never `haven up` — and worktree-local, so it configures this
  # checkout and commits nothing into anyone else's.

  @unit
  Scenario: The gate hook is installed into this worktree's own Claude settings
    Given a checkout with no Claude settings yet
    When the gate hook is installed
    Then it is written to that worktree's untracked local settings
    And installing it a second time changes nothing

  @unit
  Scenario: Settings haven does not own are merged rather than replaced
    Given settings carrying unrelated keys and hooks for other events
    When the gate hook is installed
    Then everything already there survives alongside the new entry

  @unit
  Scenario: Settings haven cannot read are never overwritten
    Given a settings file haven cannot parse, cannot read, or does not recognise the shape of
    When the gate hook is installed
    Then haven refuses and leaves the file exactly as it was
    Because writing our own idea of its contents would delete the developer's settings

  @unit
  Scenario: A gate installed from a path with a space is still recognised as haven's own
    Given a checkout whose directory name contains a space
    When the gate hook is installed a second time
    Then nothing is written, because the first one is found
    Because a quoted path read back as separate words looks like a stranger's hook,
    And every setup would leave another gate behind to run on every tool call

  @unit
  Scenario: An unrelated hook whose command merely contains the word is not mistaken for the gate
    Given an existing hook whose command contains the word gateway
    When the gate hook is installed
    Then it is actually installed rather than reported as already present
    And an existing gate whose path has since moved is replaced rather than duplicated
    Because reporting success while writing nothing leaves the machine ungoverned

  # --- Which tools wake the gate ---
  #
  # The set of tools the hook is registered for, and the set the gate has an
  # answer for, are one decision recorded in two places, and they drifted: the
  # registration named a tool the gate ignored, while the whole cache-cost half
  # was written for tools the registration never delivered. It could not fire,
  # and read as finished. Both directions are failures and both are specified
  # here, because a review caught this one and the next one deserves a test.

  @unit
  Scenario: Every tool that wakes the gate reaches something that answers
    Given the set of tools the gate is registered for
    When each of them is put to the gate
    Then none of them reaches an unconditional defer
    Because waking the gate for a tool nothing handles spends a process launch per
    And call to decide nothing, and is the same defect pointing the other way

  @unit
  Scenario: A branch of the gate is never left waiting for a tool nobody sends it
    Given a tool the gate has an answer for
    Then it is in the registered set
    Because code that cannot run reads as shipped, and is discovered in production

  @unit
  Scenario: Widening the tool set reaches a gate that is already installed
    Given a gate installed before the tool set widened
    When setup runs again from the same path
    Then the registration is brought up to the current set
    And running setup once more writes nothing
    Because the path usually has not moved, so comparing only the command reports
    And no change and leaves half the gate unreachable for everyone who set it up early

  @unit
  Scenario: A registration haven shares with another hook is left as it is
    Given an installed gate sitting alongside a hook haven did not write
    When the tool set widens
    Then the registration is not touched
    Because it covers both hooks, and widening it would re-route the developer's
    And own hook onto tools they never pointed it at
