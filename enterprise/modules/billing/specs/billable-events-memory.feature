Feature: Billing billable-event repository tiers

  @unit
  Scenario: Memory billable events keep organization, time-window, and deduplication semantics
    Given billable events written to the memory table
    When an organization reads one billing month
    Then duplicate keys count once inside the half-open UTC window
    And events from another organization or month do not count

  @unit
  Scenario: The billing ClickHouse registry routes organization and project facts
    Given the live billing ClickHouse registry
    When it reads organization usage
    Then the organization reads route by organization metadata
