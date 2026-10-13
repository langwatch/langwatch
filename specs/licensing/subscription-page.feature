Feature: Subscription Page Plan Management

  # All scenarios in this file describe page-level UX of the
  # /settings/subscription route — pricing-model-conditional rendering
  # (TIERED vs SEAT_EVENT), Add Seat button placement, loading states,
  # invoice list pagination, post-checkout activation. Need a page-level
  # integration test against the rendered Subscription page in both
  # pricing modes — no such harness exists yet.

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

  # ============================================================================
  # A plan that came from a license is still the plan the customer is on
  # ============================================================================

  Rule: A licensed enterprise plan is the current plan, not an upgrade candidate

    An enterprise customer holding a signed license is on enterprise. The page
    has to say so: no upgrade prompt, no smaller plan's feature list, and no
    invitation to buy what they already have.

    @integration
    Scenario: A licensed enterprise plan is not offered an upgrade
      Given my organization has an enterprise license
      When I view the subscription page
      Then the plan is shown as current
      And I am not told an upgrade is required
      And I am not offered a smaller plan to buy

    @integration
    Scenario: A licensed enterprise plan lists enterprise features
      Given my organization has an enterprise license
      When I view the subscription page
      Then the features listed are the enterprise ones
      And none of them describe a smaller plan's seat or event allowance

    @integration
    Scenario: A licensed plan below enterprise lists what it actually grants
      Given my organization has a license for a plan below enterprise
      When I view the subscription page
      Then I see the features and limits that apply to my plan

    @integration
    Scenario: A licensed enterprise plan is not asked to contact sales about upgrading
      Given my organization has an enterprise license
      When I view the subscription page
      Then I am not offered a way to contact sales about upgrading

    @integration
    Scenario: A capability the contract withholds is not advertised as included
      Given my organization has an enterprise license that withholds webhook endpoints
      When I view the subscription page
      Then webhook endpoints are not listed among the features I have
      And the rest of the enterprise features are still listed

  # ============================================================================
  # An organization above its plan's seats is offered the upgrade
  # ============================================================================

  Rule: An organization using more seats than its plan includes is offered an upgrade

    A plan can shrink under an organization that already filled it: a
    subscription is cancelled, an override is removed, or a backoffice edit
    moves the organization back to Free. The members stay, so the organization
    ends up using more seats than the plan includes. Nothing has to be refused
    for that to matter, so the upgrade is offered up front instead of waiting
    for the next invite to fail.

    @unit
    Scenario: Seat usage above the plan's member limit is reported as exceeded
      Given my organization is on the Free plan, which includes 2 member seats
      And my organization uses 3 member seats
      When the organization's usage is read
      Then the seat limit is reported as exceeded
      And the report says 3 seats are used and the plan includes 2

    @unit
    Scenario: Seat usage above the plan's Lite Member limit is reported as exceeded
      Given my organization is on the Free plan, which includes no Lite Member seats
      And my organization uses 2 Lite Member seats
      When the organization's usage is read
      Then the seat limit is reported as exceeded

    @unit
    Scenario: Seat usage within the plan's limits is not reported as exceeded
      Given my organization uses 2 of the 2 member seats its plan includes
      When the organization's usage is read
      Then the seat limit is reported as ok

    @unit
    Scenario: A plan with no member limit never reports the seat limit as exceeded
      Given my organization is on a plan with no member limit
      When the organization's usage is read
      Then the seat limit is reported as ok

    @unit
    Scenario: A license plan is left to the license page
      Given my organization's plan comes from a license
      And my organization uses more seats than the license covers
      When the organization's usage is read
      Then the seat limit is reported as ok

    @integration
    Scenario: Every page shows the upgrade banner while the seat limit is exceeded
      Given my organization uses more seats than its plan includes
      When I open any page in the app
      Then I see a banner saying how many seats are used and how many the plan includes
      And the banner links to the subscription page

    @integration
    Scenario: The upgrade banner is not shown while seats are within the plan
      Given my organization uses no more seats than its plan includes
      When I open any page in the app
      Then I do not see the seat limit banner

    @integration
    Scenario: The billing page marks an upgrade as required when seats are over the plan
      Given my organization is on the Free plan, which includes 2 member seats
      And my organization has 3 members
      When I view the subscription page
      Then the seat count reads 3/2
      And I am told an upgrade is required
      And I see a note that my organization uses more seats than the plan includes
      And I am offered the upgrade

    @integration
    Scenario: The billing page counts Lite Members above the plan as over the limit
      Given my organization is on the Free plan, which includes no Lite Member seats
      And my organization has a Lite Member
      When I view the subscription page
      Then I am told an upgrade is required

    @integration
    Scenario: The billing page does not mark an upgrade as required within the plan
      Given my organization is on the Free plan with 2 members
      When I view the subscription page
      Then I am not told an upgrade is required
      And I do not see the over the seat limit note

    @integration
    Scenario: Expired invites do not count toward seats on the billing page
      Given my organization is on the Free plan with 2 members
      And an invite to my organization has expired
      When I view the subscription page
      Then the seat count reads 2/2
      And I am not told an upgrade is required

    @integration
    Scenario: Expired invites are not billed when upgrading
      Given my organization is on the Free plan with 2 members
      And one invite to my organization is still open and another has expired
      When I upgrade to the Growth plan
      Then the checkout is for 3 seats
