Feature: Data retention regression safety
  As an operator
  I want retention changes to preserve policy and pinning guarantees
  So that data is neither kept nor deleted contrary to customer intent

  @regression @unit
  Scenario: Retention schema migration versions are unique
    Given the ClickHouse migration directory contains main-branch migrations
    When the data retention schema migration is added
    Then every ClickHouse migration has a unique version number

  @regression @unit
  Scenario: Existing tiered tables receive missing retention TTL
    Given a retention-managed table already has the expected cold-storage TTL
    And the table does not have a retention delete TTL
    When TTL reconciliation runs
    Then the table receives the retention delete TTL
    And the cold-storage TTL remains configured

  @regression @unit
  Scenario: Pinning a trace does not change retention
    Given a project has 49-day retention for traces
    And trace "abc123" is pinned by the user
    When ClickHouse activity is observed
    Then no retention mutation is issued for trace "abc123"
    And trace "abc123" follows the 49-day retention policy

  @regression @unit
  Scenario: Retroactive retention update applies uniformly across all retention-managed tables
    Given a project has traces stored across all retention-managed tables
    When the admin applies 91-day retention to existing trace data
    Then every retention-managed traces table receives the same project-scoped update
    And the event log receives the same project-scoped update as other tables

  @regression @unit
  Scenario: Manual pin survives unsharing an auto-shared trace
    Given trace "abc123" was pinned automatically by sharing
    And the user manually pins trace "abc123"
    When the PublicShare for trace "abc123" is deleted
    Then trace "abc123" remains pinned

  @regression @unit
  Scenario: Batched fold projections use the tenant retention policy
    Given a tenant has 49-day retention for traces
    And multiple trace events are processed through a batched fold projection
    When the folded state is stored
    Then the stored trace data uses 49-day retention
