Feature: Resource caps — shared services can't take the machine
  The shared dev services (ClickHouse, Redis, the container VM) creep up in
  memory (and log disk) until the laptop pages. haven caps what it manages
  and shows the current footprint, so a runaway service fails visibly
  instead of silently eating the machine.

  # Behavior lives in tools/thuishaven: `adapters/redisbrew/server.go`
  # applies the maxmemory ceiling (default in `domain/redis.go`,
  # DefaultRedisMaxMemoryMB; HAVEN_REDIS_MAXMEMORY_MB tunes it, 0 disables)
  # and `app/report.go` renders the doctor footprint lines. No Go tests bind
  # the two Redis/doctor scenarios below yet — both need a live Redis /
  # running stacks — so they stay `@unimplemented` until an integration
  # harness exists. (The parity checker scans tools/thuishaven's Go tests;
  # bind future scenarios with `// @scenario` annotations above the test
  # funcs.)

  # Deliberately says "the Redis haven manages", not "the shared Redis":
  # `specs/setup/haven-private-redis-plan.md` replaces the shared brew Redis
  # with per-worktree instances, and the cap applies either way.
  @integration @unimplemented
  Scenario: Managed Redis is memory-capped
    When haven ensures the Redis it manages
    Then a maxmemory ceiling is applied to it
    And the ceiling is tunable (and can be disabled) via the environment

  @integration @unimplemented
  Scenario: The doctor shows each service's memory footprint
    When I run "haven status"
    Then the ClickHouse line includes its current memory use against its cap
    And the Redis line includes its current memory use against its ceiling
    And the running stacks line includes their combined memory footprint

  # Bound by domain/clickhouse_test.go (`// @scenario` on
  # TestRenderClickHouseConfig). Disk is the cap here, not memory: stock
  # ClickHouse keeps unbounded system log tables AND a verbose server log.
  @unit
  Scenario: The managed ClickHouse keeps its own telemetry lightweight
    When haven provisions the ClickHouse it manages
    Then its logs stay within a small, bounded disk footprint over time
    But the operator can opt back into full stock logging via the environment

  # Bound by domain/clickhouse_test.go (`// @scenario` on
  # TestRenderClickHouseConfigBoundsBackgroundWork). CPU is the cap here:
  # stock ClickHouse sizes its merge and scheduling pools for a dedicated
  # server, and on the small shared VM those threads contend with the very
  # queries they exist to serve.
  @unit
  Scenario: The managed ClickHouse bounds its background work
    When haven provisions the ClickHouse it manages
    Then its background merge and scheduling pools are sized for the shared VM
    And large merges and mutations still get scheduled under the smaller pools

  # Bound by domain/clickhouse_test.go (`// @scenario` on
  # TestAssessClickHouseCeiling and TestClickHouseCeilingWarning). This is the
  # gap a kernel panic went through on 2026-09-09: haven caps the ClickHouse it
  # manages, and said nothing at all about a ClickHouse it does not manage,
  # which defaulted to ~90% of the machine and took the laptop down with it.
  @unit
  Scenario: A ClickHouse that may grow into the whole machine is called out
    Given a ClickHouse server that sets no memory ceiling of its own
    When haven checks that server against the machine it runs on
    Then the check fails
    And the report names what the server may take and what would be safe
    And it says the server sets no ceiling of its own, so a default applies

  @unit
  Scenario: A ClickHouse kept to a modest share of the machine passes
    Given a ClickHouse server whose memory ceiling is a small share of the machine
    When haven checks that server against the machine it runs on
    Then the check passes

  # The managed container and an unmanaged server reach the same verdict from
  # the same policy: the tier a server runs in changes who applies the ceiling,
  # never what counts as a safe one.
  @unit
  Scenario: The ceiling check does not depend on who manages the server
    Given two ClickHouse servers with the same ceiling on the same machine
    But only one of them is managed by haven
    When haven checks both against the machine they run on
    Then both reach the same verdict
