Feature: A dev stack that got loose is cleared
  As a developer whose laptop runs several worktrees and agents at once
  I want a stack that holds a port I need to be cleared properly
  So that an abandoned stack never makes the next one take the next slot

  # `pnpm dev` and `pnpm dev:hmr` run in the foreground, so Ctrl-C ends them; haven
  # supervises its own lanes and tears them down with the stack. The old launcher
  # supervisor (dev-supervisor.mjs) is gone: ADR-168, amendment 2026-10-10.

  # --- Clearing a stack that got loose anyway ---

  # The port conflict is where an abandoned stack is actually met: `pnpm dev`
  # refuses to start and offers to kill the tree that holds the port. That
  # offer used to be a plain SIGTERM to the process group, which a stack under
  # `concurrently --restart-tries -1` survives, so the port came back and the
  # developer took the next slot instead. That is how one worktree ends up
  # running the stack twice.
  #
  # Measured: SIGTERM to the group left the group intact with a fresh set of
  # lane pids, and the port free for under a second while the replacement
  # bound it. Anything that waits on the port rather than on the group reports
  # success into that gap.

  @unit
  Scenario: The port a stack holds is actually free afterwards
    Given a dev stack holding a port and replacing any lane that dies
    When I run what the port-conflict check tells me to run
    Then the stack is gone and the port is still free once its lanes would have come back

  @unit
  Scenario: Clearing a port leaves the shell that asked alone
    Given the developer's own shell shares a process group with something on the port
    When the ports are cleared
    Then that group is untouched, because clearing a port must not close the terminal asking

  @unit
  Scenario: Clearing ports that nothing holds is not an error
    When I clear ports nothing is listening on
    Then it says so and exits cleanly

  @unit
  Scenario: A port that cannot be inspected is never called free
    Given the only tool for looking at ports refuses to answer
    When the ports are cleared
    Then it says it could not look and fails, rather than reporting them free

  @unit
  Scenario: A listener that cannot be attributed is not blamed on a stranger
    Given the port lookup can see a listener but not which process holds it
    When the ports are cleared
    Then it says it could not look and fails, rather than calling the port someone else's
    And nothing is stopped

  @unit
  Scenario: A port held by something we did not start is reported, not claimed
    Given one of the ports is held by a process that is not a dev stack of ours
    When the ports are cleared
    Then our own stack is stopped and that process is left running
    And the ports are not reported free, because one of them is not

  @unit
  Scenario: A lane that fails takes the stack down instead of rebooting in a loop
    Given a stack whose lanes are started the way pnpm dev starts them
    And one lane exits with an error as soon as it starts
    When the stack runs
    Then the other lanes are stopped and the stack exits with a failure
    And the failed lane is not restarted
