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

  Scenario: Orphan sweep counter tracks cleaned records
    When the orphan sweep deletes 15 Annotations and 3 PublicShares
    Then data_retention_orphans_swept_total is incremented by 15 for model Annotation
    And data_retention_orphans_swept_total is incremented by 3 for model PublicShare

  Scenario: Project settings dashboard shows retention status
    When the user opens project settings
    Then they see the current retention policy per category
    And the oldest data age per table
    And active mutations with progress bars
