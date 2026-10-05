Feature: Gateway records its governance facts for webhook delivery
  A budget crossing and a virtual key lifecycle change are gateway's facts, recorded on
  gateway's governance_events_processing pipeline under main's stored names. Webhook
  subscribes to them from its own side (ARCHITECTURE §5, §9: no relay module).

  @unit
  Scenario: Spend below the warn line records no crossing
    Given a debited bucket whose current-period spend is under 80% of its limit
    When crossing detection runs
    Then nothing is recorded

  @unit
  Scenario: A budget without a positive limit never crosses
    Given a debited bucket whose budget limit is zero
    When crossing detection runs
    Then nothing is recorded, however much was spent

  @unit
  Scenario: Governance facts keep main's stored identity
    Given a virtual key lifecycle change or a budget crossing is recorded
    When the same fact is recorded again
    Then the lifecycle key is its subject, action and instant
    And the crossing key is its budget, bucket, kind and period
    And both append to governance_subject aggregates at main's event version

  @unit
  Scenario: A key lifecycle change is recorded by gateway for delivery
    Given a virtual key that is disabled with a reason
    When gateway announces the change
    Then main's lifecycle fact is recorded under the key's trace project
    And a failure to record it never fails the key mutation
