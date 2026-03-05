Feature: Unified FREE plan limits
  As a SaaS platform operator
  I want all free-tier organizations to get the same message allowance
  So that the free experience is consistent regardless of pricing model

  Background:
    Given the platform is running in SaaS mode

  @integration
  Scenario: TIERED organization on FREE plan gets 50,000 messages per month
    Given an organization with the TIERED pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 messages per month

  @integration
  Scenario: SEAT_EVENT organization on FREE plan gets 50,000 messages per month
    Given an organization with the SEAT_EVENT pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 messages per month

  @integration
  Scenario: Organization not found gets 50,000 messages per month
    Given the organization does not exist in the database
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 messages per month

  @integration
  Scenario: SEAT_EVENT organization with unknown subscription plan key
    Given an organization with the SEAT_EVENT pricing model
    And an active subscription with an unrecognized plan key
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 messages per month
    And subscription custom limits override the base free limits

  @integration
  Scenario: Valid subscription returns its own plan regardless of pricing model
    Given an organization with the SEAT_EVENT pricing model
    And an active subscription on the LAUNCH plan
    When the plan provider resolves the active plan
    Then the plan is LAUNCH with standard LAUNCH limits

  @unit
  Scenario Outline: All pricing models get 50,000 messages on the free tier
    When resolving free plan limits for <pricingModel>
    Then the limit is 50,000 messages per month

    Examples:
      | pricingModel |
      | TIERED       |
      | SEAT_EVENT   |
      | null         |
      | undefined    |
