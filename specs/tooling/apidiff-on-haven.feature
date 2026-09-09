# apidiff boots two copies of the API and diffs them. Booting them itself, on the
# developer's own Postgres, ClickHouse and Redis, is what took a running haven
# stack down: apidiff hashed its Redis databases into the same 0-15 range haven
# allocates from, and its teardown flushed both. haven already isolates one
# stack per slug and honours LANGWATCH_SLUG, so each instance becomes a haven
# stack under a slug of its own.
#
# Bound by Go tests in tools/apidiff (`go test ./...`), annotated `// @scenario`.

Feature: apidiff boots its instances through haven
  As a developer diffing a branch against main
  I want each apidiff instance to be a haven stack under its own slug
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
