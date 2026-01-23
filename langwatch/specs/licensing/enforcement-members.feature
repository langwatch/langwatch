@wip @integration
Feature: Member Limit Enforcement with License
  As a LangWatch self-hosted deployment with a license
  I want the member invite limit to be enforced
  So that organizations respect their licensed seat count

  Background:
    Given an organization "org-123" exists with 3 members
    And I am authenticated as an admin of "org-123"
    And a team "team-456" exists in the organization

  # ============================================================================
  # License-Based Member Limits
  # ============================================================================

  Scenario: Allows invite when under member limit
    Given the organization has a license with maxMembers 5
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Blocks invite when at member limit
    Given the organization has a license with maxMembers 3
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of invites allowed"

  Scenario: Blocks invite when over member limit
    Given the organization has a license with maxMembers 2
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # No License (Unlimited when enforcement disabled)
  # ============================================================================

  Scenario: No license allows unlimited members when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: No license with 100 existing members still allows invites when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 existing members
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  # ============================================================================
  # Invalid/Expired License (FREE Tier)
  # ============================================================================

  Scenario: Expired license enforces FREE tier member limit
    Given the organization has an expired license
    And the organization has 2 members
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of invites allowed"

  Scenario: Invalid license enforces FREE tier member limit
    Given the organization has an invalid license signature
    And the organization has 1 member
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Invalid license blocks at FREE tier limit
    Given the organization has an invalid license signature
    And the organization has 2 members
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Feature Flag Override
  # ============================================================================

  Scenario: Feature flag disabled allows unlimited even with license
    Given the organization has a license with maxMembers 3
    And LICENSE_ENFORCEMENT_ENABLED is "false"
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  # ============================================================================
  # Bulk Invites
  # ============================================================================

  Scenario: Blocks bulk invite that would exceed limit
    Given the organization has a license with maxMembers 5
    And the organization has 3 members
    When I invite users "a@example.com,b@example.com,c@example.com" to the organization
    Then the request fails with FORBIDDEN
