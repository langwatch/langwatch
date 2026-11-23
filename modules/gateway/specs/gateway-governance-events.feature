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

  @unit
  Scenario: A key's first admitted request records one first-request fact
    Given a drained batch admitting a request on a key whose lastUsedAt is empty
    When the spend commands are ingested
    Then gateway records one first-request fact naming the key and its organization, under the key's trace project
    And a key that already has a lastUsedAt records none

  @unit
  Scenario: Two batches that both see an unused key record its first request once
    Given two drained batches admitting the same key before either advanced its lastUsedAt
    When both are ingested
    Then both first-request facts carry one idempotency key, so the key's first request is recorded once

  @unit
  Scenario: Failing to record a first-request fact never fails the spend batch
    Given the first-request fact cannot be recorded
    When a batch admitting an unused key is ingested
    Then the spend commands are still accepted and the failure is logged

  @unit
  Scenario: A key budget's crossing names the model it spent most on
    Given a key's own budget past its warn line, 62% of its successful spend this period on gpt-5-mini
    When crossing detection runs
    Then the crossing names gpt-5-mini with a 0.62 share of the spend
    And a tie names the first model by name
    And the by-model spend is read once per crossing in a process, however many debits follow
    And a project, team, organization, principal or attributed-user crossing names no model and reads none

  @unit
  Scenario: A failed top-model read still records the crossing
    Given the by-model spend read fails
    When crossing detection runs
    Then the crossing is recorded without a top model or share
    And the debit is not re-driven

  @integration
  Scenario: A key budget's spend by model counts each request once in ClickHouse
    Given requests on a key over two models, one replayed, one failed, one before the period, each also debiting the project's budget
    When the key budget's spend by model is read since its period start
    Then each successful request in the period counts once, for the key's budget only
    And gpt-5-mini is named at a 0.62 share
