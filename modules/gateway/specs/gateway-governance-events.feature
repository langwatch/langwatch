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

  @unit
  Scenario: A key at or over the threshold with no budget is named, one under it is not
    Given two live USER keys with no budget, one that spent exactly $5 over the last seven UTC days and one a nano-dollar less
    When the unbudgeted-spend sweep runs
    Then the fact names the $5 key only
    And a key of another purpose, or a revoked or disabled key, is never named

  @unit
  Scenario: A key any budget applies to is left out of unbudgeted spend
    Given an organization's keys over the threshold, one under its own budget, one whose trace project's team or project has a budget, one whose person has a budget, and one under none
    When the unbudgeted-spend sweep runs
    Then the fact names only the key no budget applies to, resolved as the key's config bundle resolves it
    And an organization whose every key over the threshold is budgeted records nothing
    And one organization's failed read is logged and the other organizations are still recorded

  @unit
  Scenario: The fact names the five keys that spent most, and counts and totals all of them
    Given seven unbudgeted keys over the threshold in one organization
    When the unbudgeted-spend sweep runs
    Then the fact names the five that spent most, most first and ties by id, by name and spend
    And it counts all seven keys and totals their spend

  @unit
  Scenario: Every sweep of one ISO week records the organization's unbudgeted spend under one key
    Given the sweep finds the same organization unbudgeted twice in one ISO week
    When both facts are recorded
    Then both facts are appended, each carrying the idempotency key "<organization>:unbudgeted:<ISO week>"
    And the next ISO week's fact carries a new key

  @integration
  Scenario: The unbudgeted-spend sweep reads live person keys across organizations in Postgres
    Given USER keys in two organizations used since the window opened, and keys used before it, never used, revoked, disabled or of another purpose
    When the sweep lists the keys used since the window opened
    Then the read passes the tenancy guard and lists only the two live USER keys, by id
