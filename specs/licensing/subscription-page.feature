Feature: Subscription Page Plan Management
  As an organization administrator
  I want to view and manage my subscription plan and users
  So that I can understand my current plan limits and upgrade when needed

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And I navigate to the subscription page

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
  # User Management Drawer
  # ============================================================================

  @integration
  Scenario: Opens user management drawer when clicking on user count
    Given the organization has no active paid subscription
    When I click on the user count in the plan block
    Then a drawer opens showing "Manage Users"
    And I see a list of organization users

  @integration
  Scenario: User list shows member type for each user
    Given the organization has users:
      | name       | type        |
      | Admin User | Core User   |
      | Jane Doe   | Lite User   |
    When I open the user management drawer
    Then each user shows their member type badge
    And "Admin User" shows "Core User"
    And "Jane Doe" shows "Lite User"

  @integration
  Scenario: Cannot change admin user member type
    Given the organization has an admin user
    When I open the user management drawer
    Then the admin user's member type selector is disabled
    And the admin user remains as "Core User"

  @integration
  Scenario: Can change non-admin user from core to lite
    Given the organization has a non-admin core user "Jane Doe"
    When I open the user management drawer
    And I change "Jane Doe" from "Core User" to "Lite User"
    Then "Jane Doe" shows "Lite User" in the drawer
    And the changes are not yet saved to the server

  @integration
  Scenario: Can add new users in pending state
    Given I have the user management drawer open
    When I click "Add User"
    And I enter email "newuser@example.com"
    And I select member type "Lite User"
    Then a new user row appears with "newuser@example.com"
    And the new user shows as "pending"
    And the changes are not yet saved to the server

  @integration
  Scenario: Pending user changes show save button enabled
    Given I have made changes to users in the drawer
    When I view the drawer footer
    Then the "Save" button is enabled
    And I see an indicator showing unsaved changes

  @integration
  Scenario: Discarding changes resets drawer state
    Given I have made changes to users in the drawer
    When I click "Cancel" or close the drawer
    Then the drawer closes
    And reopening the drawer shows the original user state

  # ============================================================================
  # Saving User Changes - Pending State Flow
  # ============================================================================

  @integration
  Scenario: Saving users beyond plan limit creates pending state
    Given the organization is on the Developer plan with 2 users
    And I have added a third user in the user management drawer
    When I click "Save"
    Then the drawer closes
    And the new user is saved with "pending" status
    And a banner appears showing "Complete upgrade to activate pending users"

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
  # Error Handling
  # ============================================================================

  @integration
  Scenario: Shows error when save fails
    Given I have made changes to users in the drawer
    And the server will return an error
    When I click "Save"
    Then an error message appears
    And the drawer remains open with my changes preserved
    And I can retry the save operation

  @integration
  Scenario: Validates email format when adding users
    Given I have the user management drawer open
    When I click "Add User"
    And I enter an invalid email "not-an-email"
    Then I see a validation error for the email field
    And the "Add" button is disabled

  # ============================================================================
  # Loading States
  # ============================================================================

  @integration
  Scenario: Shows loading state while fetching user data
    Given the user management drawer is opening
    When the user data is being fetched
    Then a loading spinner is displayed
    And the user list area shows skeleton placeholders

  @integration
  Scenario: Shows saving state during save operation
    Given I have made changes and clicked save
    When the save operation is in progress
    Then the "Save" button shows a loading state
    And the drawer cannot be closed
    And the user list is disabled

  # ============================================================================
  # Edge Cases
  # ============================================================================

  @integration
  Scenario: Handles organization with single admin user
    Given the organization has only one user who is admin
    When I open the user management drawer
    Then I cannot change the admin to lite user
    And I see a message explaining admin requires core user status

  @integration
  Scenario: Prevents removing all core users
    Given the organization has one core user (admin) and one lite user
    When I try to convert the admin to lite user
    Then the action is blocked
    And I see a message that at least one core user is required

  @integration
  Scenario: Adding users beyond Developer plan limit shows upgrade prompt
    Given the Developer plan allows maximum 2 users
    And the organization already has 2 users
    When I add another user in the drawer
    Then I see a message that this will require upgrading to Growth plan
    And the user is added as pending
