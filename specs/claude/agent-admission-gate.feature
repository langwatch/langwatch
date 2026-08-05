Feature: haven answers an agent's tool call before it runs
  As a developer running around ten agents that cannot see each other
  I want each one's expensive commands to pass through one machine-wide gate
  So that they queue against each other instead of landing together, without haven
  ever having to drive or even know about the agents themselves

  # `haven gate` is a Claude Code hook. The direction of control is the point:
  # the agent calls haven, haven answers, haven never invokes the agent. It
  # fires inside sub-agents too. See ADR-088.
  #
  # Properties of the hook contract this relies on:
  #   - the PreToolUse payload carries the full tool_input, and the hook may
  #     return `updatedInput` to REPLACE it, so the gate can rewrite a command
  #     rather than only allowing or denying it;
  #   - it carries agent_id inside a sub-agent (and NOT in a main session),
  #     plus session_id and permission_mode;
  #   - it FAILS OPEN — a timeout, or any non-zero exit other than 2, lets the
  #     command proceed;
  #   - EXIT CODE 2 IS THE ONE CODE THAT BLOCKS. An unrecovered Go panic exits
  #     with status 2, so the language's crash default is a machine-wide
  #     tool-call blocker. That is why the discipline below is specced.
  #
  # THE REWRAP. The hook exits before the command runs, so it cannot hold a slot
  # for the command's lifetime. Rewriting the command so haven's own process
  # holds the flock avoids a lease, a TTL and a reaper. But tool_input.command
  # is a SHELL STRING, not argv, so the original is passed as one escaped
  # argument rather than spliced after a separator.
  #
  # Three contract details are UNVERIFIED and need one smoke test before any of
  # this is documented as working: the settings matcher syntax, whether
  # updatedInput is honoured alongside `defer`, and whether `/model` raises a
  # hook at all.

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

  # --- Permission boundaries are not the gate's to move ---

  @unit @unimplemented
  Scenario: The gate never approves a command the user's own rules would ask about
    Given a heavy command that the user's permission rules would prompt for
    When the gate rewrites it
    Then the normal permission flow still evaluates it
    And the gate does not return an approval of its own

  @unit @unimplemented
  Scenario: When the rewrite cannot survive the permission flow, the rewrite is dropped
    Given a session where a rewritten command cannot carry its replacement input without being approved
    When a heavy command is gated
    Then the command is left untouched
    Because losing the narrowing is better than granting an approval the user did not give

  # --- The ladder ---

  @unit @unimplemented
  Scenario: On an unloaded machine a heavy command is untouched
    Given pressure is green and a slot is free
    When a heavy command is gated
    Then it is deferred unchanged

  @unit @unimplemented
  Scenario: A short command with no slot free is narrowed
    Given pressure is amber and no slot is free
    And the command is projected to finish inside the prompt-cache floor
    When it is gated
    Then it is rewritten to run under haven's heavy class with a smaller worker count

  @unit @unimplemented
  Scenario: A long command with no slot free is queued, not narrowed
    Given pressure is amber and no slot is free
    And the command is projected to take longer than the prompt-cache floor
    When it is gated
    Then it is rewritten to queue at full width
    Because its cache is lost by running, so narrowing buys nothing

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
    And the wait itself stays under the prompt-cache floor
    But the command's own runtime is not capped by that floor, or a long suite would be killed

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
    Because an idle session loses its prompt cache, which is the cost the refusal exists to avoid

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
