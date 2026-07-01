Feature: Storage billing — reconciliation safety net (ADR-027, Phase 7)
  As finance
  I want the recorded storage totals periodically diffed against Stripe's meter totals
  So that any drift between what we think we billed and what Stripe recorded is caught

  # Off the critical path, observational only. Per org/period it compares Σ StorageUsageHourly.megabytes
  # (reportedAt set) against Stripe's own meter total and logs a drift error beyond a small tolerance —
  # catching anything the idempotency layers and the measure-time tripwire missed (e.g. a report the
  # cursor marked done that Stripe never accepted). It never mutates anything.

  @unit
  Scenario: Matching totals report no drift
    Given an organization whose recorded and Stripe totals match within tolerance
    When the period is reconciled
    Then no drift is logged

  @unit
  Scenario: Divergent totals are flagged as drift
    Given an organization whose recorded and Stripe totals diverge beyond tolerance
    When the period is reconciled
    Then a drift error is logged

  @unit
  Scenario: An unavailable Stripe total is skipped, never a false drift
    Given an organization whose Stripe meter total cannot be fetched
    When the period is reconciled
    Then the organization is counted as unavailable and no drift is flagged

  @unit
  Scenario: Each organization is reconciled independently
    Given several organizations where only one drifts
    When the period is reconciled
    Then every organization is checked and only the drifting one is flagged
