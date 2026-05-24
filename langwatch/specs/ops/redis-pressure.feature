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
  Scenario: Memory usage panel shows used / max / percent
    Given Redis reports used_memory=2.98GB, maxmemory=9.70GB, peak=9.78GB
    When the dashboard loads
    Then the Redis pressure panel shows "2.98G / 9.70G" as the memory primary value
    And it shows "31%" as the memory percent
    And it shows "peak 9.78G" as a secondary label

  @integration
  Scenario: Memory percent turns red when Redis is near eviction
    Given Redis reports used_memory=9.00GB and maxmemory=9.70GB
    When the dashboard loads
    Then the memory percent value is rendered in the warning color
    And the memory used / max line is rendered in the warning color

  @unit
  Scenario: Memory panel handles missing maxmemory configuration
    Given Redis reports maxmemory=0 (unlimited)
    When the dashboard loads
    Then the memory percent shows "-" instead of "Infinity%"
    And the used and peak values still render

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
  # Layout: replace the existing memory sublabel with a real panel
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The legacy "redisMemoryUsed sublabel under DLQ" affordance is removed
    Given the dashboard renders
    When I inspect the DLQ tile
    Then the DLQ tile no longer carries a Redis memory string as sublabel

  @integration
  Scenario: Connected clients count is visible
    Given Redis reports 24 connected clients
    When the dashboard loads
    Then the Redis pressure panel shows "24 clients"
