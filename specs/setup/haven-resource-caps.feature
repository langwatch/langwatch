Feature: Resource caps — shared services can't take the machine
  The shared dev services (ClickHouse, Redis, the container VM) creep up in
  memory until the laptop pages. haven caps what it manages and shows the
  current footprint, so a runaway service fails visibly instead of silently
  eating the machine.

  # Behavior lives in tools/thuishaven: `adapters/redisbrew/server.go`
  # applies the maxmemory ceiling (default in `domain/redis.go`,
  # DefaultRedisMaxMemoryMB; HAVEN_REDIS_MAXMEMORY_MB tunes it, 0 disables)
  # and `app/report.go` renders the doctor footprint lines. No Go tests bind
  # these scenarios yet — both need a live Redis / running stacks — so they
  # stay `@unimplemented` until an integration harness exists. (The parity
  # checker scans tools/thuishaven's Go tests; bind future scenarios with
  # `// @scenario` annotations above the test funcs.)

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
    When I run "haven doctor"
    Then the ClickHouse line includes its current memory use against its cap
    And the Redis line includes its current memory use against its ceiling
    And the running stacks line includes their combined memory footprint

  # Bound by domain/clickhouse_test.go (`// @scenario` on
  # TestRenderClickHouseConfig). Disk is the cap here, not memory: stock
  # ClickHouse keeps unbounded system log tables AND a verbose server log.
  Scenario: The managed ClickHouse keeps its own telemetry lightweight
    When haven provisions the ClickHouse it manages
    Then the high-volume system log tables are disabled
    And the kept system log tables expire after a bounded number of days
    And the server log records only warnings and rotates within a small disk budget
    But full stock logging can be restored via the environment
