Feature: Redis pressure visibility on the Ops dashboard
  As an operator looking at /ops during a queue backlog
  I want to see Redis memory and engine-CPU usage at a glance
  So that I can tell whether Redis is saturated before drilling into CloudWatch

  Context: the 2026-05-21 incident pegged Redis Engine CPU at 100% for 5+ hours
  while the /ops dashboard exposed no Redis pressure signal. Memory was technically
  collected by the backend but only surfaced as a tiny sublabel on the DLQ tile.
  CPU was never collected. Investigators had to use the Redis CLI on a replica to
  see what was happening.

  Background:
    Given I am logged in as an admin user
    And the langwatch app is connected to Redis
    And I am on the /ops dashboard

  # ---------------------------------------------------------------------------
  # Memory: surface what's already collected as a proper signal
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Memory tile shows used as the primary value
    Given Redis reports used_memory=2.98GB, maxmemory=9.69GB, peak=9.78GB
    When the dashboard loads
    Then the Redis mem tile shows "2.98GB" as the primary value
    And it shows "31% of 9.69GB" as the sublabel

  @integration
  Scenario: Memory tile turns red when Redis is near eviction
    Given Redis reports used_memory=8.84GB and maxmemory=9.69GB
    When the dashboard loads
    Then the Redis mem tile is rendered in the warning color

  @unit
  Scenario: Memory warning uses the raw ratio so 79.95% does not round up to 80%
    Given Redis reports used_memory and maxmemory at a ratio of 79.95%
    When the dashboard data is built
    Then the Redis mem tile is NOT rendered in the warning color
    And the displayed percent is 80% (rounded to one decimal)

  @unit
  Scenario: Memory tile handles missing maxmemory configuration
    Given Redis reports maxmemory=0 (unlimited)
    When the dashboard loads
    Then the memory percent is omitted instead of showing "Infinity%"
    And the sublabel falls back to "peak <bytes>"

  # ---------------------------------------------------------------------------
  # Engine CPU: new metric — the one that mattered in the incident
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Engine CPU percent is null on the first collection cycle
    Given the metrics collector has only completed one Redis INFO sample
    When the dashboard data is built
    Then the redisEngineCpuPercent field is null
    And the UI renders "-" with a "sampling…" sublabel for engine CPU

  @integration
  Scenario: Engine CPU percent is derived from two successive INFO snapshots
    Given the metrics collector has sampled Redis INFO cpu twice, 1000ms apart
    And used_cpu_user_main_thread increased by 0.3 seconds between samples
    And used_cpu_sys_main_thread increased by 0.1 seconds between samples
    When the dashboard data is built
    Then redisEngineCpuPercent equals approximately 40
    And the UI renders "40%" for engine CPU

  @unit
  Scenario: Engine CPU percent is rounded to one decimal
    Given the derived engine CPU is 12.349…%
    When the value is exposed via getDashboardData
    Then redisEngineCpuPercent equals 12.3

  @unit
  Scenario: Engine CPU percent stays at 0 when no CPU time elapsed between samples
    Given two consecutive INFO cpu samples report identical main-thread CPU counters
    When the dashboard data is built
    Then redisEngineCpuPercent equals 0

  @unit
  Scenario: Engine CPU resets cleanly when Redis restarts and counters go backwards
    Given the previous sample reported used_cpu_user_main_thread = 1000
    And the next sample reports used_cpu_user_main_thread = 5 (Redis restarted)
    When the dashboard data is built
    Then redisEngineCpuPercent is null for this cycle
    And the next sample resumes normal percent computation

  @integration
  Scenario: Engine CPU turns red when sustained load saturates the Redis main thread
    Given Redis engine CPU sampled at 82%
    When the dashboard loads
    Then the engine CPU value is rendered in the warning color

  # ---------------------------------------------------------------------------
  # Layout: inline tiles alongside the throughput metrics
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The legacy "redisMemoryUsed sublabel under DLQ" affordance is removed
    Given the dashboard renders
    When I inspect the DLQ tile
    Then the DLQ tile no longer carries a Redis memory string as sublabel

  @integration
  Scenario: Redis stats appear inline with the throughput/latency tiles
    Given the dashboard renders
    When I view the top stat strip
    Then Redis mem, Redis CPU, and Redis conns tiles appear alongside Staged/s, Completed/s, etc.
    And the tiles wrap to a second row when the viewport is too narrow

  @integration
  Scenario: Connected clients count is visible
    Given Redis reports 24 connected clients
    When the dashboard loads
    Then the Redis conns tile shows "24" with a "clients" sublabel
