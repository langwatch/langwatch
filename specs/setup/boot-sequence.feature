# A haven stack printed the boot three times over. `haven up` migrated both
# schemas itself, then the api lane's own `dev` script migrated them again —
# as three separate Node processes, each resolving secrets, each parsing its
# own config, each announcing itself. The lane is supervised, so every crash
# and every file change replayed all three, once a second for as long as the
# process kept crashing.
#
# The boot has an order, and it only makes sense in one direction: validate
# the secrets and the configuration, prove the process can boot, migrate, then
# say you are healthy. Migrating is not part of a reload, and it is not
# something every copy of a process does on its own — a stack migrates once,
# and a second runner that arrives anyway waits for the first rather than
# rebuilding a schema underneath it.
#
# See dev/docs/adr/004-docker-dev-environment.md, and
# specs/setup/schema-migrations-on-start.feature for the production start path
# this leaves untouched.

Feature: The stack migrates once, quietly, under a lock
  As a developer starting the local stack, and as an operator rolling out pods
  I want the preparation step to run once per stack start and say only what changed
  So that a reload is not a migration, two runners are not a race, and the one
  line that matters is not buried under a boot that repeated itself

  # --- One process, in order ---

  # `pnpm -s task prisma-migrate clickhouse-migrate lwql-provision` — one
  # invocation, one secret resolution, one config parse, three tasks in the
  # order they are named. LangWatchQL provisioning reads both schemas, so it
  # cannot run before either.
  @unit
  Scenario: Several task names in one invocation run in one process
    Given a runner asked for the three preparation tasks at once
    When the invocation is read
    Then all three are recognised as tasks to run, in the order given
    And no arguments are left over for any of them

  @unit
  Scenario: The tasks run in the order named and stop at the first failure
    Given a runner asked for three tasks and the second one fails
    When the invocation runs
    Then the third task never runs
    And the runner reports failure

  @unit
  Scenario: Arguments still reach a single named task
    Given a runner asked for one task followed by that task's own arguments
    When the invocation is read
    Then the one task is named and its arguments are handed to it untouched

  @unit
  Scenario: Arguments alongside several task names are refused
    Given a runner asked for two tasks and an argument
    When the invocation is read
    Then it is refused, because an argument cannot be attributed to one of them

  @unit
  Scenario: An unknown name is still reported against the catalogue
    Given a runner asked for a name no task answers to
    When the invocation is read
    Then the name is passed through unchanged, so the catalogue reports it

  # --- Once per stack start ---

  @unit
  Scenario: The local stack launcher migrates once, before the lanes
    Given the dev stack launcher
    When it starts the stack
    Then it runs the preparation step once, before any lane is started

  @unit
  Scenario: A code change reloads a lane without migrating again
    Given a running local stack
    When a source file changes and the supervised lane restarts
    Then no migration runs, because the lane's own command does not prepare

  @unit
  Scenario: A crash restart does not migrate again
    Given a supervised lane that exits non-zero and is restarted
    When it comes back up
    Then it starts the process it supervises and nothing else

  @unit
  Scenario: The orchestrator prepares the worktree through the same step
    Given haven bringing a stack up
    When it reaches the preparation step
    Then it runs the same one script the local launcher runs

  # --- Two runners, one schema ---

  @unit
  Scenario: A second runner waits for the first rather than migrating alongside it
    Given one runner already holding the migration lock
    When a second runner starts the same preparation step
    Then it waits for the lock, and only then runs the tasks
    And it finds nothing pending, because the first runner applied it

  @unit
  Scenario: Waiting is announced once, and only when there was a wait
    Given a runner that takes the lock without contention
    When the preparation step runs
    Then nothing is said about waiting

  @unit
  Scenario: A runner that has to wait says so
    Given the lock is held by another runner
    When this runner asks for it
    Then it says once that it is waiting for the migration lock

  @unit
  Scenario: The lock is released even when a task fails
    Given a runner holding the migration lock
    When one of its tasks throws
    Then the lock is released before the failure is reported

  @unit
  Scenario: A stack with no database configured prepares without a lock
    Given no database connection is configured
    When the preparation step runs
    Then it runs the tasks without waiting for anything

  # --- Configuration first ---

  @unit
  Scenario: Configuration is validated before any migration runs
    Given a configuration the runner refuses
    When the preparation step starts
    Then it refuses before the first task runs
    And it names what is missing

  # --- Quiet unless something changed ---

  # The bootstrap statements, the goose connection string, the migrations
  # directory and the per-table TTL notes all move to debug: they describe how
  # the run works, not what it did, and on an idle boot they are the whole log.
  @unit
  Scenario: An idle migration run has nothing to report
    Given goose output from a database already at the latest migration
    When the run reads what it applied
    Then it names no migration

  @unit
  Scenario: A migration that applied something is named
    Given goose output naming the migrations it ran
    When the run reads what it applied
    Then every one of them is named, at the level a person reads

  @unit
  Scenario: A table already at its intended retention is not named
    Given TTL reconciliation walking the managed tables
    When no table needs a change
    Then no table is named at the level a person reads
    And the run still reports how many it changed and how many it left alone

  # --- Readiness ---

  @unit
  Scenario: The API listens only after preparation succeeded
    Given the production start path
    When the API process starts
    Then preparation runs to completion first
    And a failed preparation means the entry point never runs
