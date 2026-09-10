# visualdiff boots two refs side by side. The last real run failed before it
# ever captured a screen: the runner boots each ref itself on fixed ports and
# a hand-rolled environment, so a base worktree with no .env crash-loops on
# missing variables, and both refs land on the developer's own Postgres,
# ClickHouse and Redis. haven already isolates one stack per slug - its own
# databases, its own Redis index, its own hostnames, injected into every
# process it starts - so each ref becomes a haven stack under a slug of its
# own instead of something visualdiff boots by hand.
#
# Bound by Go tests in tools/visualdiff (`go test ./...`), annotated `// @scenario`.

Feature: visualdiff boots its stacks through haven

  Background:
    Given haven is installed on the machine

  Rule: A stack is a haven stack with an explicit slug

    @unit
    Scenario: Each stack gets a run-scoped slug
      Given a run whose run directory names run "20260909t2230"
      When the base and candidate stacks are planned
      Then the base stack is the slug "visualdiff-20260909t2230-base"
      And the candidate stack is the slug "visualdiff-20260909t2230-candidate"
      And each is started with LANGWATCH_SLUG set to that slug in agent mode

    @unit
    Scenario: A slug never collides with a developer's stack
      Given a registered stack whose slug is "feat-strict-feature-layout-v0"
      When a stack slug is derived
      Then it starts with "visualdiff-" and can never equal a slug haven derived from a worktree

    @unit
    Scenario: Isolation comes from haven, not from AllocateRedisDBs
      When a run boots through haven
      Then visualdiff sets no DATABASE_URL, CLICKHOUSE_URL, REDIS_URL or REDIS_DB_INDEX of its own
      And the AllocateRedisDBs step never runs
      And no ephemeral port is allocated

  Rule: A run only ever stops what it started

    @unit
    Scenario: Teardown names its own two slugs
      Given both stacks are up
      When the run tears down
      Then it runs haven destroy for exactly the two visualdiff slugs
      And it removes exactly the two worktrees it added
      And no other stack is stopped, restarted or flushed

    @unit
    Scenario: A failed boot still tears down only its own slugs
      Given the candidate stack failed to become ready within the boot timeout
      When the run gives up
      Then the base stack's slug is destroyed too
      And the failure names the slug and the last lines of that stack's backend log

  Rule: Readiness and addresses come from haven, not from a fixed port scheme

    @unit
    Scenario: The instance URL is the stack's app address
      Given haven status reports the base stack
      When the stack is addressed
      Then its URL is the app hostname haven allocated for that stack
      And its API is served under /api on that same origin, so the browser and the seeder use one address

    @unit
    Scenario: Ready means haven reports the ui and backend lanes healthy
      When the run waits for a stack
      Then it polls haven status --json until both the ui lane and the backend lane are listening or the boot timeout passes

    @unit
    Scenario: A monolith base is ready when its app lane is healthy
      Given haven status reports a stack whose layout is monolith and whose one app lane is listening
      When the stack is addressed
      Then it is ready
      And its URL is the app hostname haven allocated for that stack

    @unit
    Scenario: A monolith base's failure tail reads the app lane
      Given the base stack is the monolith layout and never becomes ready
      When the run gives up
      Then the failure tail comes from haven logs app for that stack, not haven logs backend

  Rule: A fresh worktree is prepared before its stack boots

    # Run 20260910-013825 died in haven's own prepare phase on both refs: the
    # base on "Cannot find module '~/generated/prisma/client'", the candidate
    # on "Cannot find module '.../langwatch/dist/index.mjs'", both then
    # "migrations failed - nothing was dropped". A fresh `git worktree add`
    # carries none of a developer checkout's generated or built artefacts -
    # they are all gitignored - and haven's own automatic prep is
    # migrate-and-seed, not install-and-build.

    @unit
    Scenario: A fresh worktree is prepared before its stack boots
      Given a fresh worktree with none of a developer checkout's generated or built artefacts
      When the worktree is prepared, before haven up runs
      Then it installs with a frozen lockfile and CI unset
      And it runs the generated-files step
      And a modular checkout also builds the workspace packages the api and worker import a built dist from
      And the developer's own .env is copied into the worktree
      And every step's name and exit status are written to the run log, never a byte of .env's contents

    @unit
    Scenario: A monolith worktree's own generated-files step already builds the SDK
      Given a checkout on the monolith layout
      When the worktree is prepared
      Then it runs the same generated-files command as the modular layout, "pnpm run start:prepare:files"
      And it runs no separate build step for the langwatch SDK or the MCP server, because that checkout's own generated-files step already builds them

    @unit
    Scenario: A tracked dotenv file is never overwritten
      Given the workspace root holds both an untracked .env and the tracked .env.example
      When the developer's own .env is copied into the worktree
      Then .env is copied into the worktree
      And .env.example is left alone

  Rule: A monolith ref is not refused up front - haven's own answer decides

    @unit
    Scenario: visualdiff does not gate the haven path on layout
      Given a stack still on the monolith layout
      When the stack is brought up through haven
      Then visualdiff still runs haven up for it and waits on the same two lanes as a modular stack
      And whether it becomes ready is entirely haven's own answer, not a refusal visualdiff makes up front

  Rule: The port-based path remains for machines without haven

    @unit
    Scenario: haven is the default when present
      Given haven is on PATH
      When visualdiff run is invoked with no infra flags
      Then the stacks boot through haven

    @unit
    Scenario: -no-haven keeps the port-based path
      Given the -no-haven flag, or a machine with no haven on PATH
      When visualdiff run is invoked
      Then it boots exactly as before, on its own ports with AllocateRedisDBs

  Rule: A findings stream reports each comparison as it completes

    # A run's report.html/findings.json/findings.md are still written once,
    # after the whole capture finishes - but a person or an agent watching a
    # long run wants to know what broke minutes before that, not only at the
    # end. findings.jsonl is that feed: one line per screen, the instant its
    # comparison is decided, fsynced so a `tail -f` sees it immediately.

    @unit
    Scenario: Findings stream while the run is still going
      Given a run capturing routes and flows on both stacks
      When a screen's comparison is decided - a failed capture, a new console error, or a computed pixel diff
      Then one JSON line is appended to findings.jsonl straight away, with the route or flow, its kind, its guessed module, evidence image paths relative to the run root, a one-line message and an RFC 3339 capturedAt
      And the write is flushed before the run continues, so a reader tailing the file sees it without waiting for the run to finish
      And once the capture stream ends, a screen that only ever got a base capture is reported "missing-on-candidate", and a final line reports "run-complete" with the total and the count for each kind

    @unit
    Scenario: A triage loop recaptures only the routes it fixed
      Given a run was started with -keep, so its two haven stacks are still up
      When "visualdiff recapture -run RUNID -routes a,b,c" runs
      Then it reads that run's own persisted plan for the two stacks' URLs rather than re-deriving them
      And it captures only the named routes, against those same two stacks
      And it never checks out a worktree, never runs haven up, and never tears anything down
      And its findings are appended to the same run's findings.jsonl, after whatever the run itself already wrote
