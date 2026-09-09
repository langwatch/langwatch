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
