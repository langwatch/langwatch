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

  @unit
  Scenario: Organization defaults to TIERED pricing model
    Given an organization exists without explicit pricingModel
    Then the organization's pricingModel is "TIERED"

  @unit
  Scenario: Organization can be set to SEAT_EVENT pricing model
    Given an organization exists
    When the organization's pricingModel is updated to "SEAT_EVENT"
    Then the organization's pricingModel is "SEAT_EVENT"

  @integration
  Scenario: Onboarding creates organizations with SEAT_EVENT pricing model
    Given I am onboarding a new organization
    When the organization is created via onboarding
    Then the organization's pricingModel is "SEAT_EVENT"

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
  Scenario: Creating GROWTH_SEAT_EVENT subscription creates Stripe checkout
    Given the organization has pricingModel "SEAT_EVENT"
    And the organization has no active subscription
    When I call subscription.create with plan "GROWTH_SEAT_EVENT" and 3 members
    Then a PENDING subscription is created with plan "GROWTH_SEAT_EVENT"
    And a Stripe checkout session is created with seat-based line items
    And the checkout success URL points to "/settings/subscription"
    And the checkout cancel URL points to "/settings/subscription"
    And the organization's pricingModel is set to "SEAT_EVENT"

  @integration
  Scenario: Creating LAUNCH subscription still uses legacy TIERED logic
    Given the organization has pricingModel "TIERED"
    And the organization has no active subscription
    When I call subscription.create with plan "LAUNCH" and 4 members
    Then a PENDING subscription is created with plan "LAUNCH"
    And a Stripe checkout session is created with tiered line items
    And the checkout success URL points to "/settings/subscription"

  @integration
  Scenario: Managing billing portal returns correct URL for SEAT_EVENT
    Given the organization has pricingModel "SEAT_EVENT"
    When I call subscription.manage
    Then the billing portal return URL points to "/settings/subscription"

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
    Then the subscription.create mutation is called with plan "GROWTH_SEAT_EVENT"
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
    When I call addTeamMemberOrEvents with plan "ACCELERATE"
    Then the Stripe subscription is updated using tiered logic
    And no growth seat usage logic is applied

  # ============================================================================
  # TIERED → SEAT_EVENT: Lazy Upgrade
  # ============================================================================

  @integration
  Scenario: TIERED paid org sees upgrade block on subscription page
    Given the organization has pricingModel "TIERED"
    And the organization has an active ACCELERATE subscription
    When the subscription page loads
    Then a deprecated pricing notice is shown
    And an upgrade block is shown with SEAT_EVENT pricing
    And the upgrade block shows the current active member count

  @integration
  Scenario: TIERED paid org upgrade creates SEAT_EVENT checkout
    Given the organization has pricingModel "TIERED"
    And the organization has an active LAUNCH subscription with 6 active members
    When I click "Upgrade now" on the subscription page
    Then subscription.create is called with plan "GROWTH_SEAT_EVENT"
    And membersToAdd equals the current active member count

  @integration
  Scenario: After SEAT_EVENT payment old TIERED subscription is cancelled with proration
    Given the organization has pricingModel "TIERED"
    And the organization has an active ACCELERATE subscription
    And a GROWTH_SEAT_EVENT checkout was completed successfully
    When the invoice.payment_succeeded webhook fires for the SEAT_EVENT subscription
    Then the organization pricingModel is set to "SEAT_EVENT"
    And the old ACCELERATE subscription is cancelled via Stripe with proration
    And the old subscription status is CANCELLED in the database

  @integration
  Scenario: TIERED paid org can plan seats before upgrading
    Given the organization has pricingModel "TIERED"
    And the organization has an active LAUNCH subscription with 4 active members
    When I open the seat drawer and add 2 planned Full Member seats
    And I click "Upgrade now"
    Then subscription.create is called with membersToAdd 6

  @integration
  Scenario: Success page shows credit message after upgrade from TIERED
    Given the organization just upgraded from TIERED to SEAT_EVENT
    And the URL contains "?success" query parameter
    When the subscription page loads
    Then a success message shows the subscription was activated
    And a credit notice informs the user that unused time was credited

  @integration
  Scenario: Abandoned SEAT_EVENT checkout leaves TIERED subscription intact
    Given the organization has pricingModel "TIERED"
    And the organization has an active LAUNCH subscription
    When I start a GROWTH_SEAT_EVENT checkout but abandon it
    Then the LAUNCH subscription remains ACTIVE
    And the organization pricingModel is still "TIERED"

  @unit
  Scenario: Stale PENDING subscriptions are cleaned up before new checkout
    Given the organization has a PENDING GROWTH_SEAT_EVENT subscription from an abandoned checkout
    When I start a new GROWTH_SEAT_EVENT checkout
    Then the stale PENDING subscription is cancelled
    And a new PENDING subscription is created with the correct seat count

  @unit
  Scenario: maxMembers is set on PENDING subscription creation
    When I create a GROWTH_SEAT_EVENT checkout for 5 members
    Then the PENDING subscription has maxMembers set to 5

  @integration
  Scenario: maxMembers is preserved through activation lifecycle
    Given a PENDING GROWTH_SEAT_EVENT subscription with maxMembers 5
    When the invoice.payment_succeeded webhook fires
    Then the subscription is ACTIVE with maxMembers 5
    And when the subscription.updated webhook fires with quantity 5
    Then maxMembers remains 5

  @unit
  Scenario: Proration preview shows prorated amount separate from recurring total
    Given the organization has an active GROWTH_SEAT_EVENT subscription with 1 seat
    When I preview proration for 4 total seats
    Then the prorated amount reflects only the mid-cycle charge for added seats
    And the recurring total reflects the full next-period cost for all seats

  @integration
  Scenario: ENTERPRISE org does not see deprecated notice or upgrade block
    Given the organization has pricingModel "TIERED"
    And the organization has an active ENTERPRISE subscription
    When the subscription page loads
    Then a deprecated pricing notice is not shown
    And an upgrade block is not shown

  @unit
  Scenario: Duplicate subscription.deleted webhook for already-cancelled sub is idempotent
    Given the organization had a TIERED subscription cancelled during upgrade
    When a subscription.deleted webhook arrives for the already-cancelled subscription
    Then no database update is performed
    And the subscription limits are not nulled out
