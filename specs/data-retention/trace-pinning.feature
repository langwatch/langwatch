Feature: Trace pinning prevents retention deletion
  As a user
  I want to pin specific traces to prevent them from being deleted by retention
  So that important traces are preserved indefinitely

  Background:
    Given the project has 30-day retention for traces

  Scenario: Pin a trace
    When the user pins trace "abc123" with reason "regression investigation"
    Then a PinnedTrace record is created in PostgreSQL
    And ClickHouse rows for trace "abc123" are updated to _retention_days = 0
    And the update applies to stored_spans, trace_summaries, event_log, evaluation_runs, stored_log_records, and stored_metric_records

  Scenario: Unpin a trace restores project retention
    Given trace "abc123" is pinned
    When the user unpins trace "abc123"
    Then the PinnedTrace record is deleted from PostgreSQL
    And ClickHouse rows for trace "abc123" are updated to _retention_days = 30

  Scenario: Batch pinning groups mutations
    When the user pins traces "abc123", "def456", and "ghi789" within 5 seconds
    Then one batched ClickHouse mutation is issued per table
    And each mutation uses TraceId IN ('abc123', 'def456', 'ghi789')

  Scenario: Auto-pin on trace share
    When a user creates a PublicShare for trace "abc123"
    Then trace "abc123" is automatically pinned
    And the pin has no explicit user reason

  Scenario: Auto-unpin on unshare when no manual pin exists
    Given trace "abc123" was auto-pinned by sharing
    And there is no manual pin for trace "abc123"
    When the PublicShare for trace "abc123" is deleted
    Then trace "abc123" is automatically unpinned

  Scenario: Unshare does not unpin manually pinned trace
    Given trace "abc123" is manually pinned by a user
    And trace "abc123" is also shared via PublicShare
    When the PublicShare for trace "abc123" is deleted
    Then trace "abc123" remains pinned

  Scenario: New spans for pinned trace are stamped indefinite
    Given trace "abc123" is pinned
    When new spans arrive for trace "abc123"
    Then the new spans are stamped with _retention_days = 0
