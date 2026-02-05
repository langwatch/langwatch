@wip @e2e
Feature: License Lifecycle End-to-End
  As a LangWatch self-hosted administrator
  I want to manage the complete license lifecycle
  So that I can activate, use, and remove licenses for my deployment

  # ============================================================================
  # Walking Skeleton: Complete Flow
  # ============================================================================

  Scenario: Complete license activation and enforcement flow
    Given a fresh LangWatch self-hosted deployment
    And an organization "Acme Corp" exists with 3 members and 2 projects
    And I am logged in as an admin of the organization

    # Step 1: Verify no-license state
    When I navigate to the license settings page
    Then I see "No license installed"
    And I see "Running without a license. Some features may be limited."

    # Step 2: Upload a valid license
    Given I have a valid PRO license with:
      | maxMembers          | 5      |
      | maxProjects         | 5      |
      | maxMessagesPerMonth | 50000  |
      | expiresAt           | 2099-12-31 |
    When I paste the license key into the textarea
    And I click "Activate License"
    Then I see a success toast "License activated"
    And I see the license status shows "PRO"
    And I see "Members: 3 / 5"
    And I see "Expires: December 31, 2099"

    # Step 3: Verify enforcement is active
    When I navigate to the team settings
    And I try to invite 3 new members
    Then the invite fails with message "Over the limit of invites allowed"

    When I try to create a 6th project
    Then project creation fails with message "maximum number of projects"

    # Step 4: Remove the license
    When I navigate to the license settings page
    And I click "Remove License"
    Then I see an info toast "License removed"
    And I see "No license installed"

    # Step 5: Verify falls back to FREE tier limits (maxMembers: 2)
    # Organization already has 3 members, so it exceeds FREE tier limit
    When I try to invite a new member
    Then the invite fails because member limit is exceeded

  # ============================================================================
  # Invalid License Handling
  # ============================================================================

  Scenario: Attempting to upload invalid license
    Given I am on the license settings page
    And the organization has no license
    When I paste "invalid-license-key-garbage" into the textarea
    And I click "Activate License"
    Then I see an error toast "Invalid license format"
    And I still see "No license installed"

  Scenario: Attempting to upload expired license
    Given I am on the license settings page
    And I have an expired PRO license
    When I paste the expired license key
    And I click "Activate License"
    Then I see an error toast "License expired"
    And I still see "No license installed"

  # ============================================================================
  # License Expiration Behavior
  # ============================================================================

  Scenario: Organization with expired license falls to FREE tier
    Given the organization has a license that expired yesterday
    And the organization has 3 members and 3 projects
    When I check the active plan via API
    Then the plan type is "FREE"
    And maxMembers is 1
    And maxProjects is 2

    When I try to invite a new member
    Then the invite fails because member limit is exceeded

  # ============================================================================
  # API Access with License
  # ============================================================================

  Scenario: tRPC endpoints return correct license-based limits
    Given the organization has a GROWTH license with maxMembers 10
    When I call plan.getActivePlan via tRPC
    Then the response includes:
      | type       | GROWTH |
      | maxMembers | 10     |

    When I call limits.getUsage via tRPC
    Then the response includes activePlan with maxMembers 10

  # ============================================================================
  # Settings Page Navigation
  # ============================================================================

  @wip
  Scenario: License menu item appears in settings
    Given I am on any settings page
    Then I see "License" in the settings menu
    When I click on "License"
    Then I am navigated to "/settings/license"
    And the page title includes "License"
