Feature: haven answers an agent's tool call before it runs
  As a developer running around ten agents that cannot see each other
  I want each one's expensive commands to pass through one machine-wide gate
  So that they queue against each other instead of landing together, without haven
  ever having to drive or even know about the agents themselves

  # `haven gate` is a Claude Code PreToolUse hook. The direction of control is
  # the point: the agent calls haven, haven answers, haven never invokes the
  # agent. It fires inside sub-agents too. See ADR-088.
  #
  # Three properties of the hook contract this relies on, all verified against
  # the published contract:
  #   - the payload carries the full tool_input, and the hook may return
  #     `updatedInput` to REPLACE it, so the gate can rewrite a command rather
  #     than only allowing or denying it;
  #   - the payload carries `agent_id` when firing inside a sub-agent, so ten
  #     sub-agents are individually identifiable and a fair share is expressible;
  #   - it FAILS OPEN — a hook that times out, crashes, or exits non-zero other
  #     than 2 lets the command proceed. For a resource governor that is the
  #     correct default and it is not negotiable.
  #
  # THE REWRAP. The hook exits before the command runs, so it cannot hold a slot
  # for the command's lifetime. Rather than fix that with leases and TTLs, the
  # gate rewrites the command to run under `haven run --class heavy -- <original>`.
  # haven's own process then holds the flock for exactly as long as the work
  # lives — the property adapters/semaphore already documents — and the existing
  # RunOnceBounded reaper applies unchanged. The hook itself never waits.
  #
  # DENYING IS THE GENTLE OPTION. A deny costs one small turn with the prompt
  # cache warm. A six-minute park costs a cold re-read of the whole conversation
  # at cache-write rates. So under critical pressure the gate refuses
  # immediately rather than admitting a run into a queue it will sit in.
  #
  # Registered once in the user-level settings, so it covers every session and
  # sub-agent on the machine. The exact matcher syntax needs a smoke test before
  # it is documented as working — no installed plugin here uses hooks, so it
  # could not be verified by reading one.

  # --- The fast path is almost everything ---

  @unit @unimplemented
  Scenario: A command that is not heavy is waved through immediately
    Given a tool call that is not a heavy command
    When the gate is asked about it
    Then it defers to the normal permission flow
    And it does no work beyond reading a cached pressure file

  @unit @unimplemented
  Scenario: Only a small named set of commands is treated as heavy
    When the gate classifies a command
    Then only test runs, typechecks, linters, bundlers and image builds count as heavy
    And everything else defers, because gating ordinary commands would be its own outage

  # --- The ladder ---

  @unit @unimplemented
  Scenario: On an unloaded machine a heavy command is untouched
    Given pressure is green
    When a heavy command is gated
    Then it is deferred unchanged

  @unit @unimplemented
  Scenario: Under moderate pressure the command is rewritten rather than blocked
    Given pressure is amber
    When a heavy test command is gated
    Then it is rewrapped to run under haven's heavy class
    And a smaller worker count is injected
    And the caller sees an allow, not a wait

  @unit @unimplemented
  Scenario: A rewrap raises the tool's own timeout to cover the wait it may cause
    Given a command is rewrapped to run under the heavy class
    When the replacement input is built
    Then the tool timeout is raised to cover the bounded wait
    But it stays under the prompt-cache floor, so the default long timeout is never used

  @unit @unimplemented
  Scenario: Under critical pressure the command is refused immediately
    Given pressure is red and no slot is free
    When a heavy command is gated
    Then it is denied at once
    And no wait is started, because a park costs more than a refusal

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

  # --- Fan-out is capped at the source ---

  @unit @unimplemented
  Scenario: Spawning past the machine-wide agent cap is refused
    Given the machine-wide limit on concurrent sub-agents is already reached
    When another sub-agent spawn is gated
    Then it is denied
    And the reason says how many are already running

  @unit @unimplemented
  Scenario: One agent cannot hold every slot
    Given one agent already holds a heavy slot
    When the same agent asks for another
    Then it is admitted behind agents that hold none
    Because ten agents sharing a machine need a fair share, not a race

  # --- Nothing here may wedge an agent ---

  @unit @unimplemented
  Scenario: A malformed payload defers
    Given the gate is handed input it cannot parse
    Then it defers and exits successfully

  @unit @unimplemented
  Scenario: An internal failure defers
    Given the gate's own state directory is unreadable
    Then it defers and exits successfully
    Because a broken governor must never block the agents it governs

  @unit @unimplemented
  Scenario: The gate never blocks long enough to matter
    When the gate answers any tool call
    Then it returns in milliseconds
    And it never waits for a slot itself, because waiting is the wrapped command's job
