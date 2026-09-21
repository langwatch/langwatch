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
    Scenario: A ready lane that is not serving yet is waited out, not failed
      Given an instance whose lane haven has already reported ready
      When the run fetches the served OpenAPI document and the proxy answers for an upstream it cannot reach yet
      Then the fetch is retried until the document is served or the settle window passes
      And a status the instance answered for itself, such as 404, fails the run at once without waiting

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

  Rule: A probe never destroys the row a credential hangs off

    @unit
    Scenario: A delete aimed at the user behind the organization bearer is retargeted
      Given the union documents a directory route that deletes a user by id
      And the run's organization bearer token hangs off the seeded admin user
      When the probe resolves that route's id to the seeded admin user
      Then both sides are retargeted at the sacrificial user instead
      And the probe still travels the same route with the same credential, so coverage is kept whole
      And the organization bearer still authenticates when the run re-reads it at the end

  # Versioning is negotiated through the X-API-Version header. The URL forms
  # /api/<family>/latest/... and /api/<family>/<YYYY-MM-DD>/... are a supported
  # convenience fallback the document keeps publishing, but no application is
  # built against them, so a difference on one is the mount working rather than
  # drift. Measured on run 24 of 2026-09-21: 412 of 615 findings were version
  # mounts, including all 58 permission-diff:404-200 rows that had been queued
  # for a baselining decision — they needed skipping, not a baseline.
  @unit
  Scenario: A URL version mount never enters the comparison
    Given a family mounted at its bare path and at its latest and dated forms
    When the operation union is built
    Then only the bare path is compared
    And the version mounts are neither probed nor counted as skipped

  @unit
  Scenario: A family carrying its own version segment is the real surface
    Given a family mounted at /api/scim/v2
    When the operation union is built
    Then that family is compared like any other

  # Pairing on the literal path template made a renamed path parameter read as
  # a removal and an addition at once. Measured on run 24 of 2026-09-21: base
  # spells /api/projects/{id}, the candidate /api/projects/{projectId}, and 5
  # such pairs were reported as drift that did not exist.
  @unit
  Scenario: Two sides spelling one route's parameter differently are one operation
    Given the base and the candidate name the same path parameter differently
    When the operation union is built
    Then the two are paired as one operation
    And each side is probed at the spelling its own document declares

  # The harness reported its own nondeterminism as drift. Measured on run 25 of
  # 2026-09-21: 12 body_value_diff findings, of which 3 were a handle the server
  # minted for a create that named none, and 2 more carried SCIM's own spelling
  # of a timestamp — `created` and `lastModified`, which the *At pattern misses.
  @unit
  Scenario: A value this deployment minted is masked whatever key it sits under
    Given a response carrying an identifier the server generated
    When the two sides are compared
    Then that value is masked on both sides
    And a value the deployment did not mint still compares

  @unit
  Scenario: SCIM's own spelling of a timestamp is masked like every other
    Given a SCIM resource carrying created and lastModified
    When the two sides are compared
    Then both are masked
    And the resource's own type still compares

  # Pairing on the erased template made the two sides one operation, but the
  # resolved values keep the CANDIDATE's parameter names, so the base's own
  # template was left unsubstituted and probed as a literal "{id}". Measured on
  # run 26 of 2026-09-21: GET and DELETE /api/projects/{projectId} answered
  # 404 on the base against the literal placeholder, reported as drift.
  @unit
  Scenario: A side that spells a parameter differently is still given the value
    Given the base and the candidate name one path parameter differently
    When each side's path is built
    Then both carry the resolved value
    And a placeholder nothing resolved is left as it was
