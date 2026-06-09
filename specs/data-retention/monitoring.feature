Feature: Data retention monitoring
  As an operator
  I want retention health metrics and alerts
  So that I can detect when TTL is not keeping up or mutations stall

  Scenario: Retention lag metric tracks oldest data per tenant
    Given a tenant has 30-day retention configured
    And their oldest data in stored_spans is 32 days old
    When the ttlReconciler runs its retention lag check
    Then data_retention_lag_seconds is set to approximately 172800 for this tenant and table

  Scenario: Alert fires when retention lag exceeds 24 hours
    Given data_retention_lag_seconds exceeds 86400 for a tenant
    Then a stalled-retention ops alert is triggered

  Scenario: Mutation progress metric tracks retroactive updates
    Given a retroactive update is in progress with 10 parts done and 40 parts remaining
    Then data_retention_mutation_progress_ratio is set to 0.2 for this tenant and table

  Scenario: Alert fires when mutation is stuck
    Given a ClickHouse mutation has been running for more than 1 hour
    Then a stuck-mutation ops alert is triggered

  Scenario: Project settings dashboard shows retention status
    When the user opens the Retention Policies settings page
    Then the "Data Retention" section of the Retention + Usage card shows a single retention summary value when all categories share the same retention
    And the section shows per-category retention rows only when categories diverge (summary reads "Mixed")
    And active retroactive-update mutations render as a progress card below the policies table
