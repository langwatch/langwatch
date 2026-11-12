Feature: Enforcement counts billable events from entitlement's own meter
  As the owner of every organization's monthly count
  I want the live usage check to read the billable-events meter entitlement writes
  So that billing no longer reads `billable_events` and the counts stay what they were

  See dev/docs/ARCHITECTURE.md §3 (entitlement owns all counting). The per-project read keeps
  billing's approximate `uniq` query, so enforcement sees the same numbers as before.

  @unit @usage
  Scenario: Enforcement counts events from entitlement's own meter
    Given an organization metered in events whose projects have events in entitlement's meter this month
    When its usage limit is checked
    Then the count is the meter's distinct events across its projects
    And billing is not asked for a count

  @unit @usage
  Scenario: A project with no metered events this month counts zero
    Given an organization metered in events whose second project sent nothing this month
    When its billable events are counted for both projects
    Then the first project reports its events and the second reports zero

  @unit @usage
  Scenario: An organization with no projects reads no meter
    Given an organization that owns no projects
    When its billable events are counted
    Then no project is reported
    And the meter is not read

  @unit @usage
  Scenario: A meter that cannot answer fails the count rather than reading zero
    Given an organization metered in events whose meter cannot be read
    When its billable events are counted
    Then the count fails with the meter's error
    And no project is reported as zero

  @unit @usage
  Scenario: The meter counts each named project's distinct events within the month
    Given billable events written to the memory meter
    When an organization's projects are counted for one month
    Then duplicate keys count once inside the half-open UTC window
    And events from another organization, another month or an unnamed project do not count

  @unit @usage
  Scenario: Every meter read counts a metric series once per hour
    Given one metric series wrote five rows in one UTC hour and one row in the next
    When the month is read as a total, per project, per day and per type
    Then every read counts two events for the series

  @unit @usage
  Scenario: The meter counts the month's distinct events per event type
    Given billable events of several types written to the memory meter
    When an organization's month is counted per event type for its named projects
    Then each type reports its distinct keys inside the half-open UTC window
    And events from another organization, another month or an unnamed project do not count

  @unit @usage
  Scenario: The per-type meter read is an approximate distinct count grouped by event type
    Given the live meter over an organization-keyed ClickHouse
    When an organization's month is counted per event type
    Then the read is `uniq(DeduplicationKeyHash)` grouped by `EventType` over `billable_events`
    And an organization with no projects reads nothing

  @integration @usage
  Scenario: ClickHouse counts repeated metric rows of one series-hour once in every read
    Given a ClickHouse meter holding five rows of one metric series-hour, a log record and a span
    When the month is read as a total, per project, per day and per type
    Then the series counts once in every read
    And the per-type read answers one span, one log record and one metric series-hour

  @unit @usage
  Scenario: The per-project meter read is billing's approximate query
    Given the live meter over an organization-keyed ClickHouse
    When an organization's projects are counted for one month
    Then the read is `uniq(DeduplicationKeyHash)` grouped by `TenantId` over `billable_events`
    And it is scoped by the organization and filtered to the named projects
