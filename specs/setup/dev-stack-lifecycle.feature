Feature: A dev stack does not outlive whoever started it
  As a developer whose laptop runs several worktrees and agents at once
  I want `pnpm dev` to go down when the thing that started it goes away
  So that killed terminals and finished agent sessions stop leaving whole
  dev stacks running behind my back

  # Observed: 3 abandoned `pnpm dev` stacks, 35 processes, 1.27 GB, one of them
  # 5 hours old, on an 18 GB laptop at load average 51. Two worktrees were
  # running the stack TWICE, because the abandoned one still held the port and
  # the next `pnpm dev` took the next slot.
  #
  # The cause is not a missing signal handler. Every process in an abandoned
  # stack is in ONE process group, and the group leader (the shell that ran
  # `pnpm dev`) is already dead:
  #
  #   PID  PPID  PGID  COMMAND
  #   20277    1 20273 pnpm dev            <- reparented to launchd
  #   20354 20277 20273  pnpm dev
  #   ...
  #   24322 23686 20273      concurrently
  #   24390 24329 20273        vite
  #   24452 24425 20273        tsx -> node (api)
  #   28031 24589 20273        go run -> nlpgo
  #
  # Killing the launcher killed exactly one pid. Nothing signalled the group,
  # `pnpm` does not forward anything down its 8-deep script chain, and
  # `concurrently` never heard that its ancestor was gone. So all 18 survived.
  #
  # dev/scripts/dev-supervisor.mjs takes the top of that chain. It runs the
  # real command in a process group of its own, watches the group it was
  # launched from, and takes its group down when that group's leader dies.
  # Being one group of its own is what makes the takedown reach every lane at
  # once, rather than walking a tree that pnpm reshapes on every release.
  #
  # It is dev-only and it never gates: if anything about the watch fails, the
  # command still runs. A dev server that will not start is worse than one
  # that leaks.
  #
  # Knobs:
  #   LANGWATCH_DEV_SUPERVISOR=0   run the command unsupervised
  #   LANGWATCH_DEV_GRACE_MS=N     how long the stack gets to exit on its own

  # --- The happy path stays invisible ---

  @unit
  Scenario: A supervised command is indistinguishable from an unsupervised one
    When I run a dev command through the supervisor
    Then its stdout, stderr and exit code reach me unchanged
    And the supervisor prints nothing of its own

  @unit
  Scenario: A command that outlives its supervisor is still supervised
    Given a dev command that ignores the first signal it gets
    When the supervisor takes it down
    Then it is killed outright once the grace period has passed

  # --- Going down with the launcher ---

  @unit
  Scenario: The stack goes down when the process that launched it dies
    Given a dev stack started from a shell
    When that shell is killed without signalling anything else
    Then the whole stack is taken down
    And nothing is left holding the port

  @unit
  Scenario: Every lane goes down, not just the direct child
    Given a dev stack whose lanes are several processes deep, as vite, tsx and go are
    When the launcher dies
    Then the deepest lane is taken down too, because the whole stack is one process group

  # `start.sh` runs `concurrently --restart-tries -1`, whose whole job is to
  # replace a lane that dies. Stopping when our own child exits leaves those
  # replacements running and still holding the ports, which is what a real
  # stack did: the launcher, the supervisor and `pnpm start` all went, and
  # concurrently was found afterwards with a full set of brand new lane pids.
  @unit
  Scenario: A stack that restarts its own lanes is still taken down
    Given a stack that replaces any lane that dies
    When the launcher dies and the stack is asked to stop
    Then it is taken down anyway, once being asked has clearly not worked
    And no lane is left holding a port

  @unit
  Scenario: A stack that exits on its own is not waited on
    Given a dev command that exits by itself
    When it does
    Then the supervisor exits with the same code rather than waiting for its launcher

  # --- Surviving the supervisor's own death ---

  # A hard session teardown SIGKILLs the whole launching group at once: the
  # shell, the pnpm chain, and the supervisor sitting in it. The stack is
  # detached exactly so that teardown cannot reach it — which also means its
  # watcher dies watching. Observed: a bare `concurrently` at PPID 1,
  # respawning lanes for two days in a worktree nobody was in. So the watch
  # itself has to sit outside the doomed group: a sentinel in a group of its
  # own, whose only job is to notice that both the supervisor and the
  # launcher are gone and take the stack down in their place.

  @unit
  Scenario: The stack goes down even when the supervisor is killed outright
    Given a dev stack started from a shell
    When the supervisor and the shell are both killed without any signal reaching the stack
    Then the whole stack is taken down anyway

  # A sentinel started after the stack would leave a window: for as long as it
  # takes to start, a detached stack exists that the doomed group is still the
  # only watcher of, and a SIGKILL landing there leaks the stack for good. So
  # the sentinel is started first and is what starts the stack.

  @unit
  Scenario: The stack is never running without a guard outside the doomed group
    Given a dev stack started from a shell
    When the stack is running
    Then the sentinel is what started it, so no window exists in which it had no guard

  @unit
  Scenario: A sentinel that cannot be started does not stop the command
    Given a dev stack started from a shell
    When the sentinel cannot be started, or comes up and names no stack
    Then the command runs anyway, unguarded against a killed supervisor but running
    And the supervisor says the sentinel did not come up

  @unit
  Scenario: A killed supervisor alone does not take a living launcher's stack
    Given a dev stack started from a shell
    When only the supervisor is killed outright
    Then the stack keeps running for as long as the shell lives
    And it is taken down once the shell dies too

  @unit
  Scenario: Supervision leaves nothing behind when the stack exits on its own
    Given a dev command that exits by itself
    When it does
    Then no part of the supervision is still running afterwards

  # --- Not taking down more than its own ---

  @unit
  Scenario: The supervisor takes down only what it started
    Given other work running in the same process group as the launcher
    When the launcher dies and the stack is taken down
    Then that other work is untouched, because the stack has a group of its own

  @unit
  Scenario: Ctrl-C still stops the stack
    Given a dev stack running in a terminal
    When I interrupt it
    Then the whole stack is taken down rather than the top of it only

  # --- Never a gate ---

  @unit
  Scenario: A command still runs when it cannot be supervised
    Given the supervisor cannot determine what to watch
    When a dev command starts
    Then it runs anyway, unsupervised, because a dev server that will not start is worse

  @unit
  Scenario: Supervision can be turned off
    Given LANGWATCH_DEV_SUPERVISOR is 0
    When a dev command starts
    Then it runs directly, with no group of its own and nothing watching

  @unit
  Scenario: A supervisor inside a supervised stack does not add a second one
    Given a dev script that a supervised script calls in turn
    When the inner one starts
    Then it runs the command directly, because the stack above it is already supervised

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
