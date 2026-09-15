# apidiff boots two copies of the API and diffs them. Booting them itself, on the
# developer's own Postgres, ClickHouse and Redis, is what took a running haven
# stack down: apidiff hashed its Redis databases into the same 0-15 range haven
# allocates from, and its teardown flushed both. haven already isolates one
# stack per slug and honours LANGWATCH_SLUG, so each instance becomes a haven
# stack under a slug of its own.
#
# 2026-09-10 addendum: booting the branch instance IN the invoking checkout was
# its own version of the same defect. haven registers one stack per directory,
# so `haven up` there replaced a developer's own stack registration for that
# directory, and the run's teardown `haven destroy` took it down with it (an
# incident at 01:36 that day). The branch side now checks out its own HEAD into
# a worktree of its own, the same way the base side always has, and a run
# refuses outright if either worktree path would resolve to the invoking
# checkout. -dry-run prints the plan without starting anything, and a findings
# stream lets a reader tail one operation's comparison outcome at a time.
#
# Bound by Go tests in tools/apidiff (`go test ./...`), annotated `// @scenario`.

Feature: apidiff boots its instances through haven

  As a developer diffing a branch against main
  I want each apidiff instance to be a haven stack under its own slug, and
  never one that boots inside my own checkout
  So that a run never touches the stack I am using

  Background:
    Given haven is installed on the machine

  Rule: An instance is a haven stack with an explicit slug

    @unit
    Scenario: Each instance gets a run-scoped slug
      Given a run whose work root names run "20260909t2230"
      When the branch and main instances are planned
      Then the branch instance is the stack "apidiff-20260909t2230-branch"
      And the main instance is the stack "apidiff-20260909t2230-main"
      And each is started with LANGWATCH_SLUG set to that slug in agent mode

    @unit
    Scenario: A slug never collides with a developer's stack
      Given a registered stack whose slug is "feat-strict-feature-layout-v0"
      When an instance slug is derived
      Then it starts with "apidiff-" and can never equal a slug haven derived from a worktree

    @unit
    Scenario: Redis, Postgres and ClickHouse isolation come from haven
      When an instance is planned
      Then apidiff sets no DATABASE_URL, CLICKHOUSE_URL, REDIS_URL or REDIS_DB_INDEX of its own
      And it never picks a Redis logical database, creates a database or runs a migration itself
      And haven's own allocation gives the stack a free Redis database and databases named for its slug

  Rule: A fresh worktree is prepared before either stack boots

    @unit
    Scenario: A fresh worktree is prepared before its stack boots
      Given a fresh worktree with none of a developer checkout's generated or built artefacts
      When the worktree is prepared, before haven up runs
      Then the developer's own .env is copied into the worktree
      And pnpm install, the generated-files step, and - on the modular layout - the build step all run in the worktree
      And every step's name and exit status are written to the run log, never a byte of .env's contents

    @unit
    Scenario: A boot that never becomes ready reports progress and a real log tail
      Given an instance's stack has not become ready
      When the run waits past its progress interval
      Then it logs that it is still waiting, with the time elapsed and the time left
      And on timeout, the failure carries the stack's own haven log read directly off disk, not "unavailable" from a haven logs command that itself failed

  Rule: A run only ever stops what it started

    @unit
    Scenario: Teardown names its own two slugs
      Given both instances are up
      When the run tears down
      Then it runs haven destroy for exactly the two apidiff slugs
      And no other stack is stopped, restarted or flushed

    @unit
    Scenario: A failed boot still tears down only its own slugs
      Given the main instance failed to become ready within the boot timeout
      When the run gives up
      Then the branch instance's slug is destroyed
      And the failure names the slug and the last lines of that stack's backend log

  Rule: Readiness and addresses come from haven, not from apidiff's own port allocation

    @unit
    Scenario: The instance URL is the stack's API address
      Given haven status reports the branch stack
      When the instance is addressed
      Then its base URL is the API address haven allocated for that stack, which serves the /api prefix every probed path already carries
      And no ephemeral port is allocated by apidiff

    @unit
    Scenario: Ready means haven reports the backend lane healthy
      When the run waits for an instance
      Then it polls haven status --json until the backend lane is healthy or the boot timeout passes
      And the seeded credentials it probes with are the ones haven's seed wrote

    @unit
    Scenario: A monolith base is ready when its app lane is healthy
      Given haven status reports a stack whose layout is monolith and whose one app lane is listening
      When the instance is addressed
      Then it is ready
      And its base URL is the app hostname haven allocated for that stack, the same address visualdiff uses

    @unit
    Scenario: A monolith base's failure tail reads the app lane
      Given the main instance is the monolith layout and its stack never becomes ready
      When the run gives up
      Then the failure tail comes from haven logs app for that stack, not haven logs backend

  Rule: The compose path remains for machines without haven

    @unit
    Scenario: haven is the default when present
      Given haven is on PATH
      When apidiff run is invoked with no infra flags
      Then the instances boot through haven

    @unit
    Scenario: The compose and external-infra paths are opt-in
      Given the -no-haven flag, or a machine with no haven on PATH
      When apidiff run is invoked
      Then it boots exactly as before, through compose or the three -pg-url -ch-url -redis-url servers
      And a run given -env-file together with haven refuses, naming the two as exclusive

  Rule: Neither haven stack ever runs from the invoking checkout

    @unit
    Scenario: apidiff runs and the developer's own stack is untouched
      Given a developer stack is up in the invoking checkout
      When apidiff run boots both instances through haven
      Then the base instance checks out its ref into <work-root>/main, as it already did
      And the branch instance checks out HEAD into <work-root>/branch, a worktree of its own
      And every haven up and haven destroy command names one of those two worktree directories
      And no haven command ever runs with the invoking checkout as its directory
      And the developer's own stack in the invoking checkout is never started, restarted or destroyed

    @unit
    Scenario: A worktree that would alias the invoking checkout refuses to boot
      Given a work root that resolves either worktree path to the invoking checkout
      When apidiff run prepares its worktrees
      Then it refuses before any haven command runs
      And the refusal names the invoking checkout path

  Rule: Teardown destroys only the two worktree-scoped stacks

    @unit
    Scenario: Teardown never runs from the invoking checkout
      Given both instances are up as haven stacks under their own worktrees
      When the run tears down
      Then haven destroy runs for exactly the branch and base slugs
      And neither haven destroy command's directory is the invoking checkout
      And both owned worktrees are removed, and the invoking checkout is not a worktree this run owns

  Rule: -dry-run prints the plan and starts nothing

    @unit
    Scenario: The plan names both worktrees and slugs, and no command runs
      When apidiff run -dry-run is invoked
      Then it prints the base and branch worktree paths, their haven slugs, and the ordered commands a real run would issue
      And no git command, no haven command and no process is actually run

  Rule: Findings stream while the run is still going

    @unit
    Scenario: Findings stream while the run is still going
      Given a run is probing the operation union
      When one operation's comparison completes
      Then one JSON line is appended to <work-root>/findings.jsonl naming its surface, name, kind, module, detail and capturedAt
      And the line is flushed before the next operation is probed, so a reader tailing the file sees it immediately
      And when the run finishes, a final line reports kind "run-complete" with the totals by kind
