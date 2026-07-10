Feature: Pricing model backfill converges drifted organizations
  # ADR-039 rollout step 4. One-time backfill for organizations whose
  # pricingModel column drifted from their active subscription. Runs only
  # after the metering gate has moved off the column (step 1), so the
  # column update itself changes no billing behavior.

  As the platform operations team
  I want drifted pricingModel columns converged to match the active subscription
  So that display and analytics surfaces stop contradicting how the organization is billed

  @integration
  Scenario: Backfill flips organizations with an active seat-event subscription
    Given an organization with pricingModel "TIERED" and an ACTIVE "GROWTH_SEAT_EUR_ANNUAL" subscription
    When the pricing model backfill runs
    Then the organization's pricingModel becomes "SEAT_EVENT"

  @integration
  Scenario: Backfill ignores organizations whose seat subscription is cancelled
    Given an organization with pricingModel "TIERED" and a CANCELLED "GROWTH_SEAT_EUR_MONTHLY" subscription
    When the pricing model backfill runs
    Then the organization's pricingModel remains "TIERED"

  @integration
  Scenario: Backfill ignores organizations on legacy tiered plans
    Given an organization with pricingModel "TIERED" and an ACTIVE "ACCELERATE" subscription
    When the pricing model backfill runs
    Then the organization's pricingModel remains "TIERED"

  @integration
  Scenario: Backfilling the column does not change any billing decision
    Given a drifted organization whose plan already resolves to seat-event behavior
    When the pricing model backfill updates its column
    Then the organization's resolved billing profile is identical before and after the update
