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

  @unit
  Scenario: A created key's fact names the person who made it and the person it acts for
    Given a key created by a signed-in person, an API key with no owner, a legacy project key or a Connect licence
    When gateway announces the creation
    Then the fact carries the key's principal and purpose
    And it names the creator only when a person made it, never a svc_ or system: id

  @unit
  Scenario: A crossing carries when its period ends
    Given a monthly budget anchored on the 31st, crossing in the period that starts on 28 February
    When crossing detection runs
    Then the crossing's period ends on 31 March
    And a TOTAL budget's crossing names no period end

  @unit
  Scenario: Governance facts stored before the person and period fields still parse
    Given a stored lifecycle fact with no actor, principal or purpose, and a stored crossing with no period end
    When each is read through gateway's contract
    Then both parse, the missing fields reading as none
