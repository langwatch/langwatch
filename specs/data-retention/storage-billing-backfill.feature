Feature: Storage billing — SubscriptionItem backfill (ADR-027, Phase 7)
  As the storage-billing rollout
  I want to attach the STORAGE_GB item to existing paid subscriptions idempotently
  So that customers begin accruing storage usage on the announced date without re-checkout or disruption

  # Runs only after the customer notice, on the announced date. Idempotent (safe to re-run and to run
  # alongside live traffic): an already-attached item is skipped, a subscription with no matching
  # storage price is skipped and counted (never guessed), and one failure never aborts the run. Free
  # and self-hosted orgs never appear — the source lists paid subscriptions only. A dry-run reports
  # what it would do without mutating Stripe.

  @unit
  Scenario: The storage item is attached to a paid subscription that lacks it
    Given a paid subscription without the STORAGE_GB item and a resolvable price
    When the backfill runs
    Then the item is attached to that subscription

  @unit
  Scenario: A subscription that already has the item is skipped (idempotent)
    Given a paid subscription that already carries the STORAGE_GB item
    When the backfill runs
    Then the item is not attached again

  @unit
  Scenario: A subscription with no matching storage price is skipped, never guessed
    Given a paid subscription whose plan, currency, and interval have no storage price
    When the backfill runs
    Then the item is not attached and the subscription is counted as skipped

  @unit
  Scenario: A dry-run reports what it would attach without mutating Stripe
    Given a paid subscription without the item
    When the backfill runs as a dry-run
    Then Stripe is not mutated but the would-be attach is reported

  @unit
  Scenario: One subscription's failure does not abort the whole backfill
    Given several paid subscriptions where attaching one fails
    When the backfill runs
    Then the remaining subscriptions are still processed and the failure is counted
