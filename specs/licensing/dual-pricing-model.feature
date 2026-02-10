Feature: Dual Pricing Model — Per-Seat Growth Checkout
  As a LangWatch Cloud administrator
  I want to subscribe to the Growth Seat Usage plan through Stripe checkout
  So that I can pay per core member seat and access Growth features

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And the organization has pricingModel "TIERED" by default

  # ============================================================================
  # Database: PricingModel enum and field
  # ============================================================================

  @unit
  Scenario: Organization defaults to TIERED pricing model
    Given an organization exists without explicit pricingModel
    Then the organization's pricingModel is "TIERED"

  @unit
  Scenario: Organization can be set to GROWTH_SEAT_USAGE pricing model
    Given an organization exists
    When the organization's pricingModel is updated to "GROWTH_SEAT_USAGE"
    Then the organization's pricingModel is "GROWTH_SEAT_USAGE"

  # ============================================================================
  # Stripe Utility: Growth Seat Usage helpers
  # ============================================================================

  @unit
  Scenario: Identifies growth seat usage price correctly
    Given the Growth Seat Usage price ID
    When I check if it is a growth seat usage price
    Then the result is true

  @unit
  Scenario: Rejects non-growth-seat-usage price
    Given a LAUNCH users price ID
    When I check if it is a growth seat usage price
    Then the result is false

  @unit
  Scenario: Creates checkout line items for core members
    When I create checkout line items for 3 core members
    Then the result contains one line item with the growth seat usage price
    And the quantity is 3

  @unit
  Scenario: Calculates max members from quantity directly
    When I calculate max members from quantity 5
    Then the result is 5

  # ============================================================================
  # Subscription API: Create mutation routing
  # ============================================================================

  @integration
  Scenario: Creating GROWTH_SEAT_USAGE subscription creates Stripe checkout
    Given the organization has pricingModel "GROWTH_SEAT_USAGE"
    And the organization has no active subscription
    When I call subscription.create with plan "GROWTH_SEAT_USAGE" and 3 members
    Then a PENDING subscription is created with plan "GROWTH_SEAT_USAGE"
    And a Stripe checkout session is created with seat-based line items
    And the checkout success URL points to "/settings/billing"
    And the organization's pricingModel is set to "GROWTH_SEAT_USAGE"

  @integration
  Scenario: Creating LAUNCH subscription still uses legacy TIERED logic
    Given the organization has pricingModel "TIERED"
    And the organization has no active subscription
    When I call subscription.create with plan "LAUNCH" and 4 members
    Then a PENDING subscription is created with plan "LAUNCH"
    And a Stripe checkout session is created with tiered line items
    And the checkout success URL points to "/settings/subscription"

  @integration
  Scenario: Managing billing portal returns correct URL for GROWTH_SEAT_USAGE
    Given the organization has pricingModel "GROWTH_SEAT_USAGE"
    When I call subscription.manage
    Then the billing portal return URL points to "/settings/billing"

  @integration
  Scenario: Managing billing portal returns correct URL for TIERED
    Given the organization has pricingModel "TIERED"
    When I call subscription.manage
    Then the billing portal return URL points to "/settings/subscription"

  # ============================================================================
  # Webhook: Recognize growth seat usage price
  # ============================================================================

  @integration
  Scenario: Webhook computes maxMembers for growth seat usage subscription
    Given a customer.subscription.updated event
    And the subscription has a growth seat usage price item with quantity 5
    When the webhook processes the event
    Then the subscription's maxMembers is set to 5

  @integration
  Scenario: Webhook computes maxMembers for legacy LAUNCH subscription
    Given a customer.subscription.updated event
    And the subscription has a LAUNCH users price item with quantity 4
    And the subscription plan is "LAUNCH"
    When the webhook processes the event
    Then the subscription's maxMembers is set to 7
    # 4 extra + 3 base LAUNCH members

  # ============================================================================
  # SubscriptionPage: Real checkout
  # ============================================================================

  @integration
  Scenario: Clicking upgrade triggers Stripe checkout
    Given the organization has no active paid subscription
    And I have added 2 core member seats
    When I click "Upgrade now"
    Then the subscription.create mutation is called with plan "GROWTH_SEAT_USAGE"
    And the mutation is called with the total core member count

  @integration
  Scenario: Shows success state after checkout completion
    Given the URL contains "?success" query parameter
    When the subscription page loads
    Then a success message is displayed

  # ============================================================================
  # Grandfathering: Legacy subscriptions untouched
  # ============================================================================

  @integration
  Scenario: Existing TIERED subscription update works unchanged
    Given the organization has pricingModel "TIERED"
    And the organization has an active ACCELERATE subscription
    When I call addTeamMemberOrTraces with plan "ACCELERATE"
    Then the Stripe subscription is updated using tiered logic
    And no growth seat usage logic is applied
