Feature: Subscription Page Plan Management
  As an organization administrator
  I want to view and manage my subscription plan and users
  So that I can understand my current plan limits and upgrade when needed

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And I navigate to the subscription page

  # ============================================================================
  # Pricing Model Behavior
  # ============================================================================

  @integration @unimplemented
  Scenario: SEAT_EVENT organization sees billing page on subscription route
    Given the organization uses the SEAT_EVENT pricing model
    When I navigate to the subscription page
    Then I see the billing page content
    And I see the current plan block
    And I see recent invoices

  @integration @unimplemented
  Scenario: TIERED organization can view billing page and migrate
    Given the organization uses the TIERED pricing model
    When I navigate to the subscription page
    Then I see the billing page content
    And I see the current plan block
    And I see an upgrade block below the current plan block

  # ============================================================================
  # Page Layout
  # ============================================================================

  # ============================================================================
  # Plan Display - Developer (Free) Tier
  # ============================================================================

  # ============================================================================
  # Plan Display - Growth Tier
  # ============================================================================

  # ============================================================================
  # Seat Management Drawer
  # ============================================================================

  @integration @unimplemented
  Scenario: Add Seat button is positioned next to Seats available header
    When I open the seat management drawer
    Then I see a button labeled "Add Seat" with a plus icon
    And the button is aligned to the right of the "Seats available" header

  # ============================================================================
  # Drawer Auto-Fill for Available Seats
  # ============================================================================

  # ============================================================================
  # Billing Toggles and Dynamic Pricing
  # ============================================================================

  # ============================================================================
  # Saving User Changes - Pending State Flow
  # ============================================================================

  @e2e @unimplemented
  Scenario: Completing upgrade activates pending users
    Given the organization has pending users awaiting upgrade
    When I complete the payment flow for Growth plan
    Then the pending users become active
    And the "Growth" plan block shows "Current" indicator
    And the "Developer" plan block no longer shows "Current"

  # ============================================================================
  # Loading States
  # ============================================================================

  @integration @unimplemented
  Scenario: Shows loading state while fetching user data
    Given the seat management drawer is opening
    When the user data is being fetched
    Then a loading spinner is displayed
    And the user list area shows skeleton placeholders

  # ============================================================================
  # Growth Plan Seat Updates
  # ============================================================================

  # ============================================================================
  # Usage Page Seat Limit Accuracy
  # ============================================================================

  @integration @unimplemented
  Scenario: Usage page reflects purchased seat count as team member limit
    Given the organization has an active Growth subscription with 4 seats
    And the organization has 2 current core members
    When I navigate to the usage page
    Then the "Team Members" resource shows "2 / 4"

  # ============================================================================
  # Invoice Display
  # ============================================================================

  @integration @unimplemented
  Scenario: Invoices section limits display to 4 invoices
    Given the organization has a paid subscription
    And the organization has 20 invoices from Stripe
    When I view the subscription page
    Then I see exactly 4 invoices in the table

  @integration @unimplemented
  Scenario: Invoices are ordered by date descending
    Given the organization has a paid subscription
    And the organization has invoices from Stripe
    When I view the subscription page
    Then the invoices are ordered by date descending

  @integration @unimplemented
  Scenario: Subscription page remains functional when Stripe invoices fail
    Given the Stripe API is unavailable
    When I view the subscription page
    Then the current plan block is still visible

