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
