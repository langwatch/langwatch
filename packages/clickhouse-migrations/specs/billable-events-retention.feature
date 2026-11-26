Feature: Billable events are deleted after thirteen months
  As the platform operator
  I want billable_events rows older than thirteen months deleted
  So that the usage meter table stops growing without bound while the meter,
  which reads only the current and previous billing month, keeps every row it needs

  @unit
  Scenario: A migration adds the thirteen-month DELETE to billable_events
    Given the ClickHouse migrations
    When the billable_events delete TTL migration is read
    Then it sets a thirteen-month DELETE on EventTimestamp
    And it keeps the change metadata-only

  @unit
  Scenario: The reconciler keeps the DELETE when it rewrites the cold-storage MOVE
    Given a tiered billable_events table that carries the cold-storage MOVE and the DELETE
    And the operator changes the billable_events hot days
    When TTL reconciliation runs with cold storage enabled
    Then the rewritten TTL carries the new MOVE and the thirteen-month DELETE

  @unit
  Scenario: The reconciler adds the MOVE back after the migration replaced the TTL
    Given a tiered billable_events table that carries only the thirteen-month DELETE
    When TTL reconciliation runs with cold storage enabled
    Then the rewritten TTL carries the MOVE and the thirteen-month DELETE

  @unit
  Scenario: The reconciler leaves billable_events alone once both clauses are in place
    Given a tiered billable_events table that carries the MOVE and the DELETE as ClickHouse stores them
    When TTL reconciliation runs with cold storage enabled
    Then no MODIFY TTL is issued

  @unit
  Scenario: Without cold storage the reconciler still installs the DELETE
    Given a billable_events table on a non-tiered policy with no TTL
    When TTL reconciliation runs with cold storage disabled
    Then billable_events receives the thirteen-month DELETE and no MOVE
