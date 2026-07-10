Feature: Stripe metering gate derives from the active plan
  # ADR-039 rollout step 1. The event-metering population and meter unit
  # must derive from the resolved plan, never from the Organization.pricingModel
  # column, so column drift can no longer silently exclude a paying org
  # from usage billing.

  As the billing reporting pipeline
  I want the metering population and meter unit derived from the resolved plan
  So that a paying seat-billed organization is always metered regardless of stored column drift

  @integration
  Scenario: Organization with an active seat subscription and a stale TIERED column is metered
    Given an organization with pricingModel "TIERED"
    And the organization has an ACTIVE "GROWTH_SEAT_EUR_MONTHLY" subscription
    When the billing reporting pipeline selects organizations to meter
    Then the organization is included in the metering population

  @integration
  Scenario: Organization without a seat subscription is not metered even if the column says SEAT_EVENT
    Given an organization with pricingModel "SEAT_EVENT"
    And the organization has no ACTIVE seat-event subscription
    When the billing reporting pipeline selects organizations to meter
    Then the organization is not included in the metering population

  @unit
  Scenario: Meter unit comes from the resolved billing profile, not the pricingModel column
    Given an organization whose resolved plan reports meter unit "events"
    And the organization's pricingModel column says "TIERED"
    When the meter decision is resolved for the organization
    Then the decision uses meter unit "events"

  @integration
  Scenario: Metering population is unchanged for organizations without column drift
    Given an organization with pricingModel "SEAT_EVENT" and an ACTIVE seat-event subscription
    And an organization with pricingModel "TIERED" and no subscription
    When the billing reporting pipeline selects organizations to meter
    Then only the seat-subscribed organization is included
