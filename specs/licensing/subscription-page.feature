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
  # A Free organization can always upgrade
  # ============================================================================

  Rule: A Free organization is offered the Growth upgrade without changing seats

    An organization that hits the Free plan's event limit needs to upgrade
    whatever its size. Adding a seat is not a step on the way to paying.

    @integration
    Scenario: A Free organization with one member is offered the upgrade
      Given my organization is on the Free plan with 1 member
      When I view the subscription page
      Then I am offered the Growth upgrade for 1 seat
      And I am not told an upgrade is required
      And I am not told my plan doesn't cover my seats

  # ============================================================================
  # Page layout: the plan and what to do about it come first
  # ============================================================================

  Rule: The page leads with the current plan, its usage and the next step

    A Free organization usually opens this page because it hit the monthly
    event limit, so the plan card shows that usage and, under it, the action
    that fixes it. The Growth offer follows the plan card. Invoices are a record,
    not a decision, so they come last and take no space when there are none.

    @integration
    Scenario: A Free plan's card carries the Growth upgrade as its action
      Given my organization is on the Free plan with 1 member
      When I view the subscription page
      Then the current plan card has an "Upgrade to Growth" action
      And the action sits after the usage rows, like the total on a bill
      And choosing it starts the Growth checkout for 1 seat

    @integration
    Scenario: The plan card reads like a bill
      Given my organization is on the Free plan with 1 member
      When I view the subscription page
      Then the "Current" chip sits right after the plan name
      And the events and seats rows sit together in one bordered box, their figures at the right end
      And a rule separates that box from the card's action below it
      And a Free plan's box has no price row

    @integration
    Scenario: A paid plan's price is the first row of its card
      Given my organization has an active monthly Growth subscription for 2 seats at €29 each
      When I view the subscription page
      Then the card's header holds only the plan name and the "Current" chip
      And the first row of the bordered box is "Price", reading "€58/mo" then "2 seats × €29"

    @integration
    Scenario: A one-seat plan's price row does not restate the total
      Given my organization has an active monthly Growth subscription for 1 seat at €29
      When I view the subscription page
      Then the price row reads "€29/mo" with no seats breakdown

    @integration
    Scenario: The plan card keeps the approved spacing
      Given the plan card of a Growth plan with its features
      When it is drawn in a browser
      Then the rows box starts 53px below the card's top edge
      And the plan name sits 10px after the status dot, in weight 600
      And the features read in 13px text on 28px lines, each after a 12px check 20px to its left

    @integration
    Scenario: An enterprise subscription's card is named Enterprise and shows no usage row
      Given my organization has an active enterprise subscription
      And it sent 812,400 events this month
      When I view the subscription page
      Then the card's title reads "Enterprise"
      And its bordered box holds the seats row but no "Events this month" row

    @integration
    Scenario: An enterprise subscription's card offers sales contact as an orange outline
      Given the plan card of an enterprise subscription
      When it is drawn in a browser
      Then "Contact us to upgrade" draws an orange outline

    @integration
    Scenario: An enterprise plan's card has no price row
      Given my organization has an active enterprise subscription
      When I view the subscription page
      Then the card's bordered box has no price row

    @integration
    Scenario: An annual plan's price row shows the yearly total and the monthly seat price
      Given my organization has an active annual Growth subscription for 2 seats
      When I view the subscription page
      Then the price row shows the yearly total with "/yr"
      And it shows the seats times the yearly seat price, then the seat price per month

    @integration
    Scenario: The plan card holds the page's one primary upgrade button
      Given my organization is on the Free plan with 1 member
      When I view the subscription page
      Then the current plan card's "Upgrade to Growth" is the primary button
      And the Growth offer's "Upgrade now" is a secondary button
      And both start the same Growth checkout

    @integration
    Scenario: A paid plan's card carries subscription management as its action
      Given my organization has an active Growth subscription
      When I view the subscription page
      Then the current plan card has a "Manage subscription" action
      And the current plan card has no upgrade action

    @integration
    Scenario: The current plan shows this month's events against the plan's limit
      Given my organization is on the Free plan
      And my organization sent 12,000 of its 50,000 events this month
      When I view the subscription page
      Then the current plan card shows "12,000 / 50,000" events this month
      And a meter shows how much of the limit is used

    @integration
    Scenario: A Free plan at its event limit says the limit is reached
      Given my organization is on the Free plan
      And my organization used all 50,000 events this month
      When I view the subscription page
      Then the current plan card says the event limit is reached
      And I am offered the Growth upgrade

    @integration
    Scenario: A Free plan close to its event limit is warned before it is reached
      Given my organization is on the Free plan
      And my organization sent 45,000 of its 50,000 events this month
      When I view the subscription page
      Then the current plan card says the event limit is close
      And it does not say the limit is reached

    @integration
    Scenario: A plan billed per trace names traces in its usage row
      Given my organization is on the Free plan billed per trace
      And my organization used all of its traces this month
      When I view the subscription page
      Then the usage row reads "Traces this month"
      And the limit hint says new traces are not processed

    @integration
    Scenario: A plan billed per event shows the month's events without a limit
      Given my organization has an active Growth subscription billed per seat and event
      When I view the subscription page
      Then the current plan card shows the events sent this month
      And no event limit or meter is shown

    @integration
    Scenario: The plan card shows no event figure while the count is unavailable
      Given my organization is on the Free plan
      And this month's event count could not be read
      When I view the subscription page
      Then the current plan card does not show an event count

    @integration
    Scenario: The Growth offer comes right after the current plan and invoices come last
      Given my organization is on the Free plan with 1 member
      And my organization has paid invoices from an earlier subscription
      When I view the subscription page
      Then the Growth offer is the block right after the current plan card
      And the invoices are the last block on the page

    @integration
    Scenario: A Free organization with no invoices sees no invoices block
      Given my organization is on the Free plan with 1 member
      And my organization has no invoices
      When I view the subscription page
      Then I do not see an invoices block

    @integration
    Scenario: A paid plan with no invoices yet sees a one-line note
      Given my organization has an active Growth subscription
      And my organization has no invoices yet
      When I view the subscription page
      Then the invoices block says there are no invoices yet on one line

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
      Then the seat count reads 3/2 in the danger colour
      And I am told an upgrade is required, in the danger tone
      And I see a note that my organization uses more seats than the plan includes
      And I am offered the upgrade

    @integration
    Scenario: A legacy plan within its seats is asked to upgrade without the danger tone
      Given my organization is on a legacy tiered paid plan
      And my organization uses no more seats than the plan includes
      When I view the subscription page
      Then I am told an upgrade is required, in the warning tone

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

  # ============================================================================
  # A checkout asked for by the plans page starts on arrival
  # ============================================================================

  Rule: Arriving from the plans page "Upgrade now" opens Stripe Checkout

    The plans page sends the reader here with the interval and currency they
    picked. The page prices the seats it already counts and leaves for
    Stripe Checkout, so one click on "Upgrade now" reaches the payment page
    instead of landing back on the page the reader came from.

    @integration
    Scenario: The plans page upgrade opens the Growth checkout
      Given my organization is on the Free plan with 2 members
      When I arrive on the subscription page from the plans page asking for the annual Growth plan in USD
      Then a Growth checkout for 2 seats, billed annually in USD, is created
      And I am sent to the Stripe Checkout page it answers
      And the checkout request is removed from the address, so returning from Stripe does not start another

    @integration
    Scenario: A checkout request is dropped when the organization cannot buy Growth here
      Given my organization is already on the Growth plan
      When I arrive on the subscription page asking for the Growth checkout
      Then no checkout is created
      And the checkout request is removed from the address

    @integration
    Scenario: A refused checkout tells the reader why and stays on the page
      Given my organization is on the Free plan with 2 members
      And I am not allowed to manage the organization's billing
      When I arrive on the subscription page asking for the Growth checkout
      Then I see why the upgrade could not start
      And I stay on the subscription page
