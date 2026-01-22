@integration
Feature: LicenseHandler Service
  As a LangWatch self-hosted deployment
  I want a service to manage licenses and return plan info
  So that subscription limits can be enforced based on the stored license

  Background:
    Given an organization exists with id "org-123"

  # ============================================================================
  # getActivePlan: No License (Backward Compatible)
  # ============================================================================

  Scenario: Returns UNLIMITED_PLAN when no license is stored
    Given the organization has no license
    And LICENSE_ENFORCEMENT_ENABLED is not set
    When I get the active plan for the organization
    Then the plan type is "SELF_HOSTED"
    And maxMembers is 99999

  Scenario: Returns UNLIMITED_PLAN when license field is null
    Given the organization license field is null
    When I get the active plan for the organization
    Then the plan type is "SELF_HOSTED"

  # ============================================================================
  # getActivePlan: Valid License
  # ============================================================================

  Scenario: Returns license-based PlanInfo when valid license is stored
    Given the organization has a valid license with plan:
      | type                | GROWTH |
      | maxMembers          | 10     |
      | maxProjects         | 99     |
      | maxMessagesPerMonth | 100000 |
    When I get the active plan for the organization
    Then the plan type is "GROWTH"
    And maxMembers is 10
    And maxProjects is 99
    And maxMessagesPerMonth is 100000

  # ============================================================================
  # getActivePlan: Invalid/Expired License
  # ============================================================================

  Scenario: Returns FREE_PLAN when license signature is invalid
    Given the organization has a license with invalid signature
    When I get the active plan for the organization
    Then the plan type is "FREE"
    And maxMembers is 2
    And maxProjects is 2

  Scenario: Returns FREE_PLAN when license is expired
    Given the organization has an expired license
    When I get the active plan for the organization
    Then the plan type is "FREE"
    And canPublish is false

  # ============================================================================
  # getActivePlan: Feature Flag
  # ============================================================================

  Scenario: Returns UNLIMITED_PLAN when LICENSE_ENFORCEMENT_ENABLED is false
    Given the organization has a valid license with maxMembers 5
    And LICENSE_ENFORCEMENT_ENABLED is "false"
    When I get the active plan for the organization
    Then the plan type is "SELF_HOSTED"
    And maxMembers is 99999

  Scenario: Enforces license when LICENSE_ENFORCEMENT_ENABLED is true
    Given the organization has a valid license with maxMembers 5
    And LICENSE_ENFORCEMENT_ENABLED is "true"
    When I get the active plan for the organization
    Then maxMembers is 5

  # ============================================================================
  # storeLicense: Success Cases
  # ============================================================================

  Scenario: Stores valid license in organization
    Given a valid license key for plan "PRO" expiring "2025-12-31T23:59:59Z"
    When I store the license for the organization
    Then the operation succeeds
    And the organization license field is updated
    And the organization licenseExpiresAt is "2025-12-31T23:59:59Z"
    And the organization licenseLastValidatedAt is set to now

  Scenario: Returns planInfo after successful store
    Given a valid license key for plan "ENTERPRISE" with maxMembers 1000
    When I store the license for the organization
    Then the result includes planInfo with:
      | type       | ENTERPRISE |
      | maxMembers | 1000       |

  # ============================================================================
  # storeLicense: Failure Cases
  # ============================================================================

  Scenario: Rejects invalid license format
    Given a license key "not-a-valid-license"
    When I store the license for the organization
    Then the operation fails with error "Invalid license format"
    And the organization license field is unchanged

  Scenario: Rejects license with invalid signature
    Given a license key with tampered data
    When I store the license for the organization
    Then the operation fails with error "Invalid signature"

  Scenario: Rejects expired license on upload
    Given a valid but expired license key
    When I store the license for the organization
    Then the operation fails with error "License expired"

  # ============================================================================
  # getLicenseStatus
  # ============================================================================

  Scenario: Returns status for organization with no license
    Given the organization has no license
    When I get the license status
    Then hasLicense is false
    And valid is false

  Scenario: Returns status for valid license
    Given the organization has a valid license with plan "GROWTH" expiring "2025-06-30"
    When I get the license status
    Then hasLicense is true
    And valid is true
    And plan is "GROWTH"
    And expiresAt is "2025-06-30"

  Scenario: Returns status for expired license
    Given the organization has an expired license with plan "PRO"
    When I get the license status
    Then hasLicense is true
    And valid is false
    And plan is "PRO"
