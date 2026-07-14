Feature: Resource caps — shared services can't take the machine
  The shared dev services (ClickHouse, Redis, the container VM) creep up in
  memory until the laptop pages. haven caps what it manages and shows the
  current footprint, so a runaway service fails visibly instead of silently
  eating the machine.

  Scenario: Managed Redis is memory-capped
    When haven ensures the shared Redis
    Then a maxmemory ceiling is applied to it
    And the ceiling is tunable (and can be disabled) via the environment

  Scenario: The doctor shows each service's memory footprint
    When I run "haven doctor"
    Then the ClickHouse line includes its current memory use against its cap
    And the Redis line includes its current memory use against its ceiling
    And the running stacks line includes their combined memory footprint
