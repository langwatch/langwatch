Feature: Dual Pricing Model — Seat+Usage Billing
  As a LangWatch Cloud administrator
  I want to subscribe via the seat+usage pricing model through Stripe checkout
  So that I can pay per core member seat and access Growth features

  # PricingModel vs PlanTypes:
  #   PricingModel describes HOW billing works: "TIERED" (legacy) vs "SEAT_EVENT" (new seat+usage model).
  #   PlanTypes describes WHAT plan the org is on: "GROWTH_SEAT_EVENT", "LAUNCH", "ACCELERATE", etc.

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And the organization has pricingModel "TIERED" by default

  # ============================================================================
  # Database: PricingModel enum and field
  # ============================================================================

  @unit @unimplemented
  Scenario: Organization defaults to TIERED pricing model
    Given an organization exists without explicit pricingModel
    Then the organization's pricingModel is "TIERED"

  @unit @unimplemented
  Scenario: Organization can be set to SEAT_EVENT pricing model
    Given an organization exists
    When the organization's pricingModel is updated to "SEAT_EVENT"
    Then the organization's pricingModel is "SEAT_EVENT"

  @integration @unimplemented
  Scenario: Onboarding creates organizations with SEAT_EVENT pricing model
    Given I am onboarding a new organization
    When the organization is created via onboarding
    Then the organization's pricingModel is "SEAT_EVENT"

  # ============================================================================
  # Stripe Utility: Growth Seat Usage helpers
  # ============================================================================

  # ============================================================================
  # Subscription API: Create mutation routing
  # ============================================================================

  @integration @unimplemented
  Scenario: Creating GROWTH_SEAT_EVENT subscription creates Stripe checkout
    Given the organization has pricingModel "SEAT_EVENT"
    And the organization has no active subscription
    When I call subscription.create with plan "GROWTH_SEAT_EVENT" and 3 members
    Then a PENDING subscription is created with plan "GROWTH_SEAT_EVENT"
    And a Stripe checkout session is created with seat-based line items
    And the checkout success URL points to "/settings/subscription"
    And the checkout cancel URL points to "/settings/subscription"
    And the organization's pricingModel is set to "SEAT_EVENT"

  @integration @unimplemented
  Scenario: Creating LAUNCH subscription still uses legacy TIERED logic
    Given the organization has pricingModel "TIERED"
    And the organization has no active subscription
    When I call subscription.create with plan "LAUNCH" and 4 members
    Then a PENDING subscription is created with plan "LAUNCH"
    And a Stripe checkout session is created with tiered line items
    And the checkout success URL points to "/settings/subscription"

  @integration @unimplemented
  Scenario: Managing billing portal returns correct URL for SEAT_EVENT
    Given the organization has pricingModel "SEAT_EVENT"
    When I call subscription.manage
    Then the billing portal return URL points to "/settings/subscription"

  @integration @unimplemented
  Scenario: Managing billing portal returns correct URL for TIERED
    Given the organization has pricingModel "TIERED"
    When I call subscription.manage
    Then the billing portal return URL points to "/settings/subscription"

  # ============================================================================
  # Webhook: Recognize growth seat usage price
  # ============================================================================

  @integration @unimplemented
  Scenario: Webhook computes maxMembers for growth seat usage subscription
    Given a customer.subscription.updated event
    And the subscription has a growth seat usage price item with quantity 5
    When the webhook processes the event
    Then the subscription's maxMembers is set to 5

  # ============================================================================
  # SubscriptionPage: Real checkout
  # ============================================================================

  @integration @unimplemented
  Scenario: Shows success state after checkout completion
    Given the URL contains "?success" query parameter
    When the subscription page loads
    Then a success message is displayed

  # ============================================================================
  # Grandfathering: Legacy subscriptions untouched
  # ============================================================================

  @integration @unimplemented
  Scenario: Existing TIERED subscription update works unchanged
    Given the organization has pricingModel "TIERED"
    And the organization has an active ACCELERATE subscription
    When I call addTeamMemberOrEvents with plan "ACCELERATE"
    Then the Stripe subscription is updated using tiered logic
    And no growth seat usage logic is applied

  # ============================================================================
  # TIERED → SEAT_EVENT: Lazy Upgrade
  # ============================================================================

  @integration @unimplemented
  Scenario: TIERED paid org can plan seats before upgrading
    Given the organization has pricingModel "TIERED"
    And the organization has an active LAUNCH subscription with 4 active members
    When I open the seat drawer and add 2 planned Full Member seats
    And I click "Upgrade now"
    Then subscription.create is called with membersToAdd 6

  @integration @unimplemented
  Scenario: Success page shows credit message after upgrade from TIERED
    Given the organization just upgraded from TIERED to SEAT_EVENT
    And the URL contains "?success" query parameter
    When the subscription page loads
    Then a success message shows the subscription was activated
    And a credit notice informs the user that unused time was credited

  @integration @unimplemented
  Scenario: Abandoned SEAT_EVENT checkout leaves TIERED subscription intact
    Given the organization has pricingModel "TIERED"
    And the organization has an active LAUNCH subscription
    When I start a GROWTH_SEAT_EVENT checkout but abandon it
    Then the LAUNCH subscription remains ACTIVE
    And the organization pricingModel is still "TIERED"

  @unit @unimplemented
  Scenario: maxMembers is set on PENDING subscription creation
    When I create a GROWTH_SEAT_EVENT checkout for 5 members
    Then the PENDING subscription has maxMembers set to 5

  @integration @unimplemented
  Scenario: maxMembers is preserved through activation lifecycle
    Given a PENDING GROWTH_SEAT_EVENT subscription with maxMembers 5
    When the invoice.payment_succeeded webhook fires
    Then the subscription is ACTIVE with maxMembers 5
    And when the subscription.updated webhook fires with quantity 5
    Then maxMembers remains 5

