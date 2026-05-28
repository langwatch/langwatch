Feature: Trace pinning as a UI annotation
  As a user
  I want to pin specific traces so they are easy to find later
  So that important traces stand out in the UI

  Note: Pinning is a UI annotation only. It does NOT override the project's
  data-retention policy. Pinned traces age out with the project policy like
  every other trace.

  Background:
    Given the project has 30-day retention for traces

  Scenario: Pin a trace
    When the user pins trace "abc123" with reason "regression investigation"
    Then a PinnedTrace record is created in PostgreSQL
    And no ClickHouse mutation is issued for trace "abc123"
    And trace "abc123" continues to follow the project's 30-day retention policy

  Scenario: Unpin a trace
    Given trace "abc123" is pinned
    When the user unpins trace "abc123"
    Then the PinnedTrace record is deleted from PostgreSQL
    And no ClickHouse mutation is issued for trace "abc123"

  Scenario: Auto-pin on trace share
    When a user creates a PublicShare for trace "abc123"
    Then trace "abc123" is automatically pinned with source "share"
    And no ClickHouse mutation is issued for trace "abc123"

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
