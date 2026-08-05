Feature: haven answers an agent's tool call before it runs
  As a developer running around ten agents that cannot see each other
  I want each one's expensive commands to pass through one machine-wide gate
  So that they queue against each other instead of landing together, without haven
  ever having to drive or even know about the agents themselves

  # `haven gate` is a Claude Code hook. The direction of control is the point:
  # the agent calls haven, haven answers, haven never invokes the agent. It
  # fires inside sub-agents too. See ADR-088.
  #
  # Properties of the hook contract, MEASURED against a headless session with a
  # scratch settings file rather than read from docs:
  #   - the matcher shape works: a hooks.PreToolUse[] entry with matcher "Bash"
  #     and a hooks[] array of {type: command, command, timeout} fires;
  #   - the payload carries session_id, transcript_path, cwd, prompt_id,
  #     permission_mode, effort.level, hook_event_name, tool_name, tool_input
  #     and tool_use_id — and NO agent_id in a main session;
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

  @unit @unimplemented
  Scenario: A command that is not heavy is waved through
    Given a tool call that is not a heavy command
    When the gate is asked about it
    Then it defers to the normal permission flow
    And the admission half does no work beyond reading one cached pressure file
    # Scoped deliberately to admission: the repeat detector in
    # specs/claude/llm-cost-safety.feature must record something per call, so
    # "no work" cannot hold for the gate as a whole.

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: A heavy command is passed to haven as one escaped argument
    Given a heavy command under pressure
    When the gate rewrites it
    Then the original command is passed as a single escaped argument for a shell to run
    And it is not spliced after a separator, because the command is a shell string and not argv

  @unit @unimplemented
  Scenario: A command containing shell operators is gated as a whole
    Given a heavy command joined to another command by a shell operator
    When it is rewritten
    Then the whole line runs under the slot
    And no part of it escapes the slot by being parsed at the outer level

  @unit @unimplemented
  Scenario: A command already under haven's heavy class is not rewrapped again
    Given a command that is already wrapped
    When the gate is asked about it
    Then it is left alone
    Because a nested wrap makes the outer hold the slot the inner waits for

  @unit @unimplemented
  Scenario: The rewrap names haven by absolute path
    Given haven is not on the caller's PATH
    When a command is rewritten
    Then the rewritten command still runs
    Because installing haven onto PATH is optional, and a rewrite that fails has broken a working command

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
  Scenario: A command with no slot free is rewritten to queue
    Given pressure is amber and no slot is free
    And the session's cache writes went to the long-lived cache
    When it is gated
    Then it is rewritten to queue at full width
    Because at that cache lifetime the wait costs nothing, and a queued run holds no memory

  @unit @unimplemented
  Scenario: A short command in a short-lived-cache session is narrowed instead
    Given pressure is amber and no slot is free
    And the session's cache writes went to the short-lived cache
    And the command is projected to finish inside that floor
    When it is gated
    Then it is rewritten to run under haven's heavy class with a smaller worker count

  @unit @unimplemented
  Scenario: At critical pressure with no slot free the command is refused
    Given pressure is red and no slot is free
    When a heavy command is gated
    Then it is denied at once
    And no wait is started

  @unit @unimplemented
  Scenario: The tool timeout is raised by the wait, not capped at the floor
    Given a command rewritten to run under haven's heavy class
    When the replacement input is built
    Then the tool timeout is raised by the admission wait the run may incur
    And the wait itself is bounded by whichever ceiling that session's cache lifetime earns
    But the command's own runtime is not capped by that ceiling, or a long suite would be killed

  # --- The refusal has to be actionable ---

  @unit @unimplemented
  Scenario: A refusal explains the state in terms the caller can act on
    When the gate denies a heavy command
    Then the reason names the current pressure and how many runs are queued
    And it names work that is safe to do instead

  @unit @unimplemented
  Scenario: A refusal never invites the caller to sleep or poll
    When the gate denies a heavy command
    Then the reason explicitly tells the caller not to sleep, poll or wait for it
    Because sleeping buys nothing the queue would not have given, and in a session
    on the short-lived cache it also loses the cache the refusal was protecting

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

  @unit @unimplemented
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
