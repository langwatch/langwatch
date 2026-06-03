Feature: ClickHouse TTL activation for data retention
  As the TTL reconciler
  I manage retention DELETE TTL rules alongside cold-storage tiering TTL
  So that expired rows are removed during background merges

  # Retention values are whole weeks (multiples of 7 days), matching the
  # weekly partition key. The cold-storage default is 49 days (7 weeks).

  Scenario: TTL expression evaluates correctly for active retention
    Given a stored_spans row with _retention_days = 49 and StartTime = 56 days ago
    When ClickHouse evaluates the TTL expression during a background merge
    Then the row is deleted because StartTime + 49 days is in the past

  Scenario: Retention TTL coexists with cold-storage tiering
    Given stored_spans has a cold-storage TTL of 49 days on EndTime
    When retention TTL is activated for stored_spans
    Then both TTL rules are set in a single ALTER TABLE MODIFY TTL
    And cold-storage moves data to cold volume after 49 days
    And retention deletes data after _retention_days from StartTime

  Scenario: materialize_ttl_after_modify prevents full re-scan
    When the ttlReconciler applies a retention TTL rule
    Then the ALTER TABLE command includes SETTINGS materialize_ttl_after_modify = 0
    And ClickHouse does NOT re-scan all existing parts

  Scenario: Row-level TTL precision in shared partitions
    Given a weekly partition contains tenant A with 49-day retention and tenant B with 91-day retention
    When the partition is merged after 56 days
    Then tenant A's rows are deleted
    And tenant B's rows are preserved

  Scenario: ReplacingMergeTree dedup runs before TTL
    Given two versions of the same row exist (same ORDER BY key)
    And both have _retention_days = 49 and are expired
    When ClickHouse merges the part
    Then RMT deduplication keeps the latest version first
    And TTL evaluation deletes the surviving row because it is expired

  Scenario: suite_runs is included in TTL configuration
    When the ttlReconciler runs
    Then suite_runs has both cold-storage and retention TTL rules
    And it uses StartedAt as the retention anchor
