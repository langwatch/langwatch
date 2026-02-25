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

  @integration
  Scenario: SEAT_EVENT organization sees billing page on subscription route
    Given the organization uses the SEAT_EVENT pricing model
    When I navigate to the subscription page
    Then I see the billing page content
    And I see the current plan block
    And I see recent invoices

  @integration
  Scenario: TIERED organization can view billing page and migrate
    Given the organization uses the TIERED pricing model
    When I navigate to the subscription page
    Then I see the billing page content
    And I see the current plan block
    And I see an upgrade block below the current plan block

  @integration
  Scenario: TIERED organization current block shows legacy plan from subscription data
    Given the organization uses the TIERED pricing model
    And the organization has an active ACCELERATE subscription
    When I view the subscription page
    Then the current plan block title is "Accelerate"
    And the current plan block shows the organization user count

  # ============================================================================
  # Page Layout
  # ============================================================================

  @integration
  Scenario: Displays subscription page with two plan blocks
    When the subscription page loads
    Then I see two plan blocks: "Developer" (Free) and "Growth"
    And I see a "Need more? Contact sales" link below the plan blocks

  # ============================================================================
  # Plan Display - Developer (Free) Tier
  # ============================================================================

  @integration
  Scenario: Displays Developer plan as current when organization has no paid subscription
    Given the organization has no active paid subscription
    When the subscription page loads
    Then the "Developer" plan block shows "Current" indicator
    And the Developer plan shows the following characteristics:
      | characteristic        | value                          |
      | price                 | Free                           |
      | logs per month        | 50,000                         |
      | data retention        | 14 days                        |
      | users                 | 2                              |
      | scenarios             | 3                              |
      | simulations           | 3                              |
      | custom evaluations    | 3                              |
      | support               | Community (GitHub & Discord)   |
    And the Developer plan shows "Get Started" button

  @integration
  Scenario: Shows current organization user count in Developer plan block
    Given the organization has no active paid subscription
    And the organization has 2 users
    When the subscription page loads
    Then the Developer plan block displays "2 users"
    And the user count is displayed as a clickable link

  # ============================================================================
  # Plan Display - Growth Tier
  # ============================================================================

  @integration
  Scenario: Displays Growth plan features
    When the subscription page loads
    Then the "Growth" plan block shows the following characteristics:
      | characteristic        | value                                    |
      | price                 | €29/seat/month                           |
      | events included       | 200,000 + €1 per 100k extra              |
      | data retention        | 30 days + custom retention (€3/GB)       |
      | core users            | Up to 20 (after volume discount)         |
      | lite users            | Unlimited                                |
      | evals and simulations | Unlimited                                |
      | support               | Private Slack / Teams                    |
    And the Growth plan shows "Try for Free" button

  # ============================================================================
  # Seat Management Drawer
  # ============================================================================

  @integration
  Scenario: Opens seat management drawer when clicking on user count
    Given the organization has no active paid subscription
    When I click on the user count in the plan block
    Then a drawer opens showing "Manage Seats"
    And I see a collapsible "Show N Members" button for current members
    And I see a "Seats available" section

  @integration
  Scenario: Drawer does not display alert banners
    When I open the seat management drawer
    Then I do not see an admin-requires-core-user info banner
    And I do not see a core-user-limit-exceeded warning banner

  @integration
  Scenario: User list shows member type for each user
    Given the organization has users:
      | name       | type        |
      | Admin User | Full Member |
      | Jane Doe   | Lite Member |
    When I open the seat management drawer
    Then each user shows their member type badge
    And "Admin User" shows "Full Member"
    And "Jane Doe" shows "Lite Member"

  @integration
  Scenario: Add Seat button is positioned next to Seats available header
    When I open the seat management drawer
    Then I see a button labeled "Add Seat" with a plus icon
    And the button is aligned to the right of the "Seats available" header

  @integration
  Scenario: Clicking Add Seat adds a pending seat immediately
    When I open the seat management drawer
    And I click "Add Seat"
    Then a new pending seat row appears with an email input and a "Full Member" badge
    And the pending seat count increases by 1

  @integration
  Scenario: Can enter email for a pending seat
    When I open the seat management drawer
    And I click "Add Seat"
    And I enter "newuser@example.com" in the seat email field
    Then the pending seat row shows the entered email

  @integration
  Scenario: Clicking Add Seat multiple times in a row adds multiple seats
    When I open the seat management drawer
    And I click "Add Seat" 3 times in a row
    Then 3 new pending seat rows appear in the drawer

  @integration
  Scenario: Each batch-added seat can be removed individually
    When I open the seat management drawer
    And I click "Add Seat" 3 times in a row
    And I remove the second pending seat
    Then 2 pending seat rows remain in the drawer

  @integration
  Scenario: Batch-added seats reflect in the total user count
    When I open the seat management drawer
    And I click "Add Seat" 3 times in a row
    And I close the drawer by clicking Done
    Then the subscription page shows a total of 5 users

  @integration
  Scenario: Cancelling the drawer discards all batch-added seats
    When I open the seat management drawer
    And I click "Add Seat" 2 times in a row
    And I click "Cancel"
    And I reopen the seat management drawer
    Then no pending seat rows are shown

  @integration
  Scenario: Closing the drawer with Done preserves batch-added seats
    When I open the seat management drawer
    And I click "Add Seat" 2 times in a row
    And I close the drawer by clicking Done
    And I reopen the seat management drawer
    Then 2 pending seat rows are shown

  # ============================================================================
  # Drawer Auto-Fill for Available Seats
  # ============================================================================

  @integration
  Scenario: Drawer shows available seat rows for unused seats on Growth plan
    Given the organization has an active Growth subscription with 6 seats
    And the organization has 1 active core member
    When I open the seat management drawer
    Then I see 5 empty seat rows in the "Seats available" section
    And the drawer footer shows "Total Seats: 6"

  @integration
  Scenario: Drawer shows remaining available seats when some are pending
    Given the organization has an active Growth subscription with 6 seats
    And the organization has 1 active core member
    And the organization has 2 pending core invites
    When I open the seat management drawer
    Then I see 3 empty seat rows in the "Seats available" section
    And the drawer footer shows "Total Seats: 6"

  @integration
  Scenario: Closing drawer without changes does not trigger subscription update
    Given the organization has an active Growth subscription with 6 seats
    And the organization has 2 active core members
    When I open the seat management drawer
    And I close the drawer by clicking Done without entering any emails
    Then the subscription page does not show the "Update seats" block

  @integration
  Scenario: Filling email in auto-filled row sends invite without changing subscription
    Given the organization has an active Growth subscription with 6 seats
    And the organization has 2 active core members
    When I open the seat management drawer
    And I enter "newuser@example.com" in the first available seat row
    And I close the drawer by clicking Done
    Then an invite is sent to "newuser@example.com"
    And no subscription update is triggered

  @integration
  Scenario: Deleting auto-filled empty row shows subscription downgrade option
    Given the organization has an active Growth subscription with 6 seats
    And the organization has 2 active core members
    When I open the seat management drawer
    And I delete an empty available seat row
    And I close the drawer by clicking Done
    Then I see an "Update seats" block showing reduced seat count

  @integration
  Scenario: Free plan user filling seat does not send invite
    Given the organization has no active paid subscription
    When I open the seat management drawer
    And I click "Add Seat"
    And I enter "newuser@example.com" in the seat email field
    And I close the drawer by clicking Done
    Then no invite is sent
    And the "Upgrade required" badge appears on the current plan block

  # ============================================================================
  # Billing Toggles and Dynamic Pricing
  # ============================================================================

  @integration
  Scenario: Page shows currency selector and billing period toggle
    When the subscription page loads
    Then I see a currency selector defaulting to EUR
    And I see a billing period toggle with Monthly and Annually options

  @integration
  Scenario: Switching to annual billing shows 8% discount badge
    When I select "Annually" billing
    Then a "Save 8%" badge appears

  @integration
  Scenario: Upgrade block shows dynamic total based on core members
    Given the organization has 2 existing core members
    And I have added 1 core member seat in the drawer
    Then the upgrade block shows total for 3 core members

  @integration
  Scenario: Upgrade block total updates when switching currency or billing period
    Given the organization has 3 core members
    When I switch the currency to USD or toggle billing period
    Then the upgrade block total recalculates accordingly

  @integration
  Scenario: Clicking Upgrade now redirects to Stripe checkout
    Given the organization has pending seats
    When I click "Upgrade now"
    Then a Stripe checkout session is created with the seat breakdown
    And the user is redirected to the Stripe checkout URL

  # ============================================================================
  # Saving User Changes - Pending State Flow
  # ============================================================================

  @integration
  Scenario: Adding seats beyond plan limit shows upgrade required
    Given the organization is on the Developer plan with 2 users
    And I have added a third seat in the seat management drawer
    When I click "Done"
    Then the "Upgrade required" badge appears on the current plan block

  @e2e
  Scenario: Completing upgrade activates pending users
    Given the organization has pending users awaiting upgrade
    When I complete the payment flow for Growth plan
    Then the pending users become active
    And the "Growth" plan block shows "Current" indicator
    And the "Developer" plan block no longer shows "Current"

  @integration
  Scenario: Growth plan block shows current after upgrade
    Given the organization has an active Growth subscription
    When I view the subscription page
    Then the "Growth" plan block shows "Current" indicator
    And the Growth plan shows the organization's current usage

  # ============================================================================
  # Loading States
  # ============================================================================

  @integration
  Scenario: Shows loading state while fetching user data
    Given the seat management drawer is opening
    When the user data is being fetched
    Then a loading spinner is displayed
    And the user list area shows skeleton placeholders

  # ============================================================================
  # Growth Plan Seat Updates
  # ============================================================================

  @integration
  Scenario: Growth plan user can add seats and update subscription
    Given the organization has an active Growth subscription
    When I open the seat management drawer
    And I click "Add Seat"
    And I close the drawer by clicking Done
    Then I see an "Update seats" block with seat count and price
    And I can click "Update subscription" to finalize the changes

  @integration
  Scenario: Clicking Discard on Update seats block restores original state
    Given the organization has an active Growth subscription
    When I open the seat management drawer
    And I click "Add Seat"
    And I close the drawer by clicking Done
    And I click "Discard" on the Update seats block
    Then the "Update seats" block disappears
    And the user count returns to its original value

  @integration
  Scenario: Growth plan user sees Manage Subscription button
    Given the organization has an active Growth subscription
    When the subscription page loads
    Then I see a "Manage Subscription" button on the current plan block

  @integration
  Scenario: Free plan user does not see Manage Subscription button
    Given the organization has no active paid subscription
    When the subscription page loads
    Then I do not see a "Manage Subscription" button on the current plan block

  # ============================================================================
  # Usage Page Seat Limit Accuracy
  # ============================================================================

  @integration
  Scenario: Usage page reflects purchased seat count as team member limit
    Given the organization has an active Growth subscription with 4 seats
    And the organization has 2 current core members
    When I navigate to the usage page
    Then the "Team Members" resource shows "2 / 4"
