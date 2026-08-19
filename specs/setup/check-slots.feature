Feature: Machine-wide slots for whole-repo checks
  As a developer whose laptop runs several worktrees and agents at once
  I want `pnpm typecheck` and `pnpm lint` to queue instead of piling up
  So that N parallel checks never take the machine down, and a slow one
  explains itself instead of looking hung

  # Both checks saturate the machine on purpose. A tsgo run peaks around 3 to 4
  # GiB and uses every core; a biome run over 6,800 files spends 38 CPU-seconds
  # in 4 seconds of wall clock. That is the right trade for one run, and capping
  # either tool's threads only stretches the same CPU cost over 5x the wall
  # clock. Three or four at once, which is the normal state of a laptop driving
  # several worktrees or agents, is what makes the machine unusable, and neither
  # command knew another was already running.
  #
  # `platform/app`'s typecheck, lint and format scripts now run through
  # dev/scripts/check-queue.mjs, a thin wrapper that takes a machine-wide
  # slot, runs the real command, and releases. ONE counter covers all of them,
  # because they compete for the same cores. The state is a directory of
  # per-run JSON entries (pid, arrival sequence, label, state) under the
  # system temp dir, so every worktree, terminal and agent on the machine
  # counts against the same total. Waiters are served in arrival order.
  #
  # The wrapper is deliberately boring on the happy path: with a free slot it
  # prints nothing at all and passes stdio, exit code and signals straight
  # through. It only speaks when a run has to wait, which is exactly when an
  # agent needs to know that the extra minutes were queueing rather than a
  # hung tool.
  #
  # Knobs, all optional:
  #   CHECK_SLOTS=N            how many may run at once (0 disables the gate)
  #   CHECK_PRESSURE=<level>   force the memory-pressure level (green/amber/red)
  #   CHECK_QUEUE_DIR=<path>   where the shared state lives
  #   CHECK_QUEUE_POLL_MS=N    how often a waiter re-checks
  #   CHECK_QUEUE_HEARTBEAT_MS how often a waiting run repeats itself
  #   CHECK_QUEUE_MAX_WAIT_MS  after this, run anyway rather than hang
  #
  # `haven typecheck` keeps its own RAM slot (ADR-064) and turns this gate off
  # for the run it spawns, so a run is never counted by both.

  # --- The happy path stays invisible ---

  @unit
  Scenario: A run that finds a free slot is silent
    Given no other check holds a slot
    When I run a check through the queue
    Then the command runs immediately
    And the wrapper prints nothing of its own

  @unit
  Scenario: The wrapper is transparent to the command it runs
    Given a command that fails
    When I run it through the queue
    Then its exit code reaches the caller unchanged
    And its stdout and stderr are passed through untouched

  # --- Waiting, and saying so ---

  @unit
  Scenario: A run past the limit waits and names what it is waiting for
    Given the limit is 1 and a check is already running
    When a second check starts
    Then it does not run the command yet
    And it reports that 1 check is already active and that it is queued
    And the report names the limit and the environment variable that changes it

  @unit
  Scenario: Lint and typecheck queue against the same counter
    Given the limit is 1 and a typecheck is already running
    When a lint starts
    Then the lint waits for the typecheck to finish
    And the two never run at the same time, because they compete for the same cores

  @unit
  Scenario: A run that waited says how long it waited
    Given a run that spent time in the queue
    When its slot frees up
    Then it reports the time it spent queued before running the command

  @unit
  Scenario: A long wait repeats itself so it never looks hung
    Given a run has been queued for longer than the heartbeat interval
    When it re-checks
    Then it repeats its position and how long it has waited
    And it names the runs holding the slots and how long they have held them

  @unit
  Scenario: Waiters are served in arrival order
    Given the limit is 1, one run holding the slot and two queued behind it
    When the holder finishes
    Then the run that queued first is the one that starts

  # --- Nothing may hold a slot forever ---

  @unit
  Scenario: A slot held by a dead process is reclaimed
    Given a run holding the only slot is killed without releasing it
    When another run checks the queue
    Then the dead run's entry is dropped
    And the waiting run starts

  @unit
  Scenario: A malformed entry from another branch cannot crash the queue
    Given the shared directory holds an entry written in a shape this branch does not understand
    When a check reads the queue
    Then the entry is dropped rather than reaching code that assumes its fields
    And the check runs

  @unit
  Scenario: A queue that cannot be created degrades to an unqueued run
    Given the shared directory cannot be created or written
    When a check starts
    Then it warns that the queue is unavailable
    And it runs the command without a slot, because the queue is a courtesy and never a gate

  @unit
  Scenario: A run that waits too long runs anyway
    Given the maximum wait has elapsed and no slot has freed up
    When the waiting run re-checks
    Then it warns that it is starting without a slot
    And it runs the command rather than hanging

  # --- Choosing the limit ---

  @unit
  Scenario: The limit can be turned off
    Given CHECK_SLOTS is 0
    When several checks run at once
    Then none of them queue

  @unit
  Scenario: An explicit limit is honored
    Given CHECK_SLOTS is 1
    When three checks are started at once
    Then only one of them runs at a time

  @unit
  Scenario: The default limit is derived from the machine
    Given CHECK_SLOTS is not set
    When the limit is resolved on a developer machine
    Then it is one slot per 6 GiB of RAM, capped at one per 4 CPUs, and never below 1

  @unit
  Scenario: CI does not queue by default
    Given CI is set and CHECK_SLOTS is not
    When a check runs
    Then the gate is off, because a CI runner runs one check at a time anyway

  # --- Memory pressure: the machine says the formula's assumption is false ---

  # The derived limit and the 6 GiB memory ceiling both assume an otherwise
  # idle machine. A machine that is already compressing and swapping is the
  # machine saying that assumption is false: its RAM is spoken for, and every
  # gigabyte a check takes is paid by evicting someone else's pages. Under
  # pressure the check runs in its smallest shape, so the check pays for the
  # shortage in its own time instead of everything else paying in swap.
  # The level and its thresholds are ADR-090's (domain/pressure.go): either
  # swap fill or compressor occupancy alone can raise it. A machine the queue
  # cannot read is green, because a governor that cannot see must not throttle.

  @unit
  Scenario: Memory pressure narrows the queue to one run
    Given the machine reports amber or red memory pressure
    And CHECK_SLOTS is not set
    When the limit is resolved
    Then it is one, whatever the formula would have said
    And an explicit CHECK_SLOTS still wins, because it is the operator's call

  @unit
  Scenario: Memory pressure lowers the memory ceiling to the floor
    Given the machine reports amber or red memory pressure
    When a check runs through the queue
    Then its GOMEMLIMIT is the 3 GiB floor, whatever the machine's size
    And an operator's explicit GOMEMLIMIT still reaches it unchanged

  @unit
  Scenario: Memory pressure halves the compiler's parallelism
    Given the machine reports amber or red memory pressure
    When a check runs through the queue
    Then its GOMAXPROCS is half the cores, never below two
    And a green machine sets no GOMAXPROCS at all
    And an operator's explicit GOMAXPROCS still wins

  @unit
  Scenario: A forced pressure level overrides the measurement
    Given CHECK_PRESSURE is set to green, amber or red
    When the level is resolved
    Then the forced level is used instead of measuring the machine
    And a misspelled level falls back to the measurement, like a CHECK_SLOTS typo

  # --- A killed run must not read as the queue's doing ---

  # Observed in the wild: a whole-tree typecheck ended in a bare exit 137, and
  # the agent driving it concluded the queue had killed it and re-ran with
  # CHECK_SLOTS=0, removing the machine-wide serialization for everyone. The
  # queue never kills runs; a signal death it did not forward is an operator
  # kill or the OS reclaiming memory, and the wrapper now says so at the
  # moment it happens, where the next reader of the transcript will see it.

  @unit
  Scenario: A run killed from outside is reported as not the queue's doing
    Given a check is running through the queue
    When the command dies by a signal the wrapper did not forward
    Then the wrapper says the queue never kills runs and names the likely causes
    And it says to re-run the same command rather than set CHECK_SLOTS=0
    And a signal the wrapper itself forwarded, like Ctrl-C, is not reported
    And a command that fails on its own is not reported

  # --- The bin shims: the package scripts are not the only way in ---

  # Wrapping the scripts left every other route to the binary uncounted, and
  # they get used: `pnpm exec tsgo --noEmit -p tsconfig.tsgo.json`,
  # `./node_modules/.bin/tsgo`, and the standing advice to iterate with
  # targeted checks, widened to the whole project. Observed in the wild as
  # three tsgo processes on an 18 GB laptop with the limit set to 2, one of
  # them started from the same worktree as a properly queued run.
  #
  # dev/scripts/install-check-shims.mjs makes platform/app's bin entries
  # themselves the boundary, so the route into the tool stops mattering. Only
  # platform/app's: sdks/typescript's build runs `tsc --noEmit` on the way to
  # `pnpm dev`, and a dev server that waits for a typecheck slot before it
  # boots is not an improvement.

  @unit
  Scenario: A whole-project run counts however it was started
    When I run "pnpm exec tsgo --noEmit -p tsconfig.tsgo.json" instead of "pnpm typecheck"
    Then the run counts against the limit, exactly as the script would have

  @unit
  Scenario: A run over a directory counts
    When I run "biome check ./src ./ee"
    Then the run counts against the limit

  @unit
  Scenario: A run that names no target counts
    When I run a check with flags only, which walks the project from the cwd
    Then the run counts against the limit

  # A subcommand and a flag's value are positional too, and reading either as a
  # file to check is what turns a whole-project run into one nothing waits for.
  @unit
  Scenario: A subcommand or a flag's value is not a target
    When I run "biome check" with no paths, or "tsgo --pretty false"
    Then the run counts against the limit, because neither names a file and both walk the project

  @unit
  Scenario: A run that names files starts immediately
    When I run "tsgo --noEmit src/foo.ts"
    Then it starts without waiting, so the iterate-fast loop never sits behind a full run

  @unit
  Scenario: A watch or a language server starts immediately
    When I start a check with "--watch" or "--lsp"
    Then it starts without waiting, because it would hold its slot for the whole session

  @unit
  Scenario: A check does not queue behind itself
    Given "pnpm typecheck" holds the only slot
    When the tsgo it runs would otherwise ask for a slot of its own
    Then it starts without waiting
    And the check does not sit out the maximum wait before starting

  @unit
  Scenario: The tool behaves the same either way
    Given one check that counts and one that does not
    When each runs
    Then its arguments, output and exit code are what they would be without the queue

  @unit
  Scenario: Reinstalling leaves the tools working
    Given the bin entries already route whole-project runs through the queue
    When "pnpm install" runs again
    Then the tools still run, and still count the same runs

  @unit
  Scenario: A fresh install restores the counting pnpm overwrote
    Given "pnpm install" has replaced the bin entries with its own
    When the postinstall step runs
    Then whole-project runs count again

  # Otherwise a fix to how runs are classified would never reach a checkout
  # that had already been installed once, which is every checkout.
  @unit
  Scenario: An earlier version of the routing is brought up to date
    Given the bin entries were routed through the queue by an earlier version of the installer
    When the postinstall step runs
    Then they are replaced with the current one, and the tools still run

  @unit
  Scenario: An install that cannot write leaves the tool working
    Given the bin directory cannot be written to
    When the postinstall step runs
    Then the tool still runs, because losing the count is survivable and losing the tool is not

  # The shims are a laptop concern, and neither environment below is a laptop.
  # CI turns the queue off anyway, so a shim there only puts a node process in
  # front of every tsc and biome to decide nothing, and an install in an image
  # or on a server has no bin entries worth rewriting.

  @unit
  Scenario: CI installs are left alone
    Given CI is set to anything but "0" or "false"
    When the postinstall step runs
    Then it changes nothing, and says which environment it stood down for

  @unit
  Scenario: Production installs are left alone
    Given NODE_ENV is production
    When the postinstall step runs
    Then it changes nothing

  # --- The queue lives inside haven ---

  # The queue's decisions are Go code in haven: `haven slot run -- <cmd>`
  # takes a slot from the same flock semaphore `haven typecheck` holds — one
  # counter for everything that saturates the cores — then runs the command
  # with the gate off and the Go memory cap set, exactly as the JS wrapper
  # would. check-queue.mjs delegates to it whenever the haven binary is
  # installed (HAVEN_BIN overrides where to look), and keeps its JavaScript
  # queue only as the fallback for machines without haven. Flock slots die
  # with their holder, so a killed run frees its slot with no bookkeeping.

  @unit
  Scenario: With haven installed the queue runs inside haven
    Given the haven binary is installed
    When a whole-repo check runs through the queue
    Then the run is handed to haven's slot command
    And the command's exit code reaches the caller unchanged

  @unit
  Scenario: Without haven the JavaScript queue still gates
    Given no haven binary is installed
    When a whole-repo check runs through the queue
    Then the JavaScript queue takes the slot and runs the command

  @unit
  Scenario: The operator can force the JavaScript queue
    Given CHECK_QUEUE_IMPL is js
    When a whole-repo check runs through the queue
    Then haven is never consulted

  @unit
  Scenario: haven derives the same limit the JavaScript queue would
    Given CHECK_SLOTS is unset on a developer machine
    When haven resolves the slot limit
    Then it is one slot per 6 GiB of RAM, capped at one per 4 CPUs, and never below 1
    And an explicit CHECK_SLOTS, a disabling value, and CI resolve exactly as the JavaScript queue resolves them

  @unit
  Scenario: haven's slot run is transparent to the command
    Given a command that fails
    When it runs under haven's slot command with a free slot
    Then its exit code reaches the caller unchanged and nothing extra is printed
    And the child runs with the gate off and the Go memory cap set, so it cannot queue behind itself

  @unit
  Scenario: A run queued inside haven says so
    Given every check slot is held
    When a run starts under haven's slot command
    Then it reports it is queued and names the knob that changes the limit
    And once a slot frees it reports how long it queued

  @unit
  Scenario: haven typecheck and delegated checks share one counter
    Given "haven typecheck" holds a check slot
    Then a delegated check counts against the same semaphore, not a second ledger

  @unit
  Scenario: haven typecheck is not gated twice
    Given "haven typecheck" already holds one of its own RAM slots
    When it runs "pnpm typecheck"
    Then it passes CHECK_SLOTS=0 to that run
    And the run is counted once, by haven's slot
