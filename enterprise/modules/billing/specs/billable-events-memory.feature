Feature: Billing billable-event repository tiers

  @unit
  Scenario: Memory billable events keep organization, time-window, and deduplication semantics
    Given billable events written by the memory meter
    When an organization reads one billing month
    Then duplicate keys count once inside the half-open UTC window
    And events from another organization or month do not count

  @unit
  Scenario: The billing ClickHouse registry shares the meter with the monthly reader
    Given the billing ClickHouse memory registry
    When its meter writes a billable event
    Then its monthly reader counts that event

  @unit
  Scenario: The billing ClickHouse registry routes organization and project facts
    Given the live billing ClickHouse registry
    When it reads organization usage, reads project traces, and meters an event
    Then the organization reads route by organization metadata
    And the project read and meter row retain their project tenant
