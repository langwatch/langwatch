Feature: Pricing-model-aware FREE plan limits
  As a SaaS platform operator
  I want the FREE plan to respect the organization's pricing model
  So that SEAT_EVENT organizations get appropriate event limits on the free tier

  Background:
    Given the platform is running in SaaS mode

  @integration
  Scenario: TIERED organization on FREE plan gets 1,000 traces per month
    Given an organization with the TIERED pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 1,000 messages per month

  @integration
  Scenario: SEAT_EVENT organization on FREE plan gets 50,000 events per month
    Given an organization with the SEAT_EVENT pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 messages per month

  @integration
  Scenario: Organization not found falls back to default FREE limits
    Given the organization does not exist in the database
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 1,000 messages per month

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
  Scenario Outline: FREE plan limits vary by pricing model
    When resolving free plan limits for <pricingModel>
    Then the limit is <maxMessagesPerMonth> messages per month

    Examples:
      | pricingModel | maxMessagesPerMonth |
      | TIERED       | 1,000               |
      | SEAT_EVENT   | 50,000              |
      | null         | 1,000               |
      | undefined    | 1,000               |
