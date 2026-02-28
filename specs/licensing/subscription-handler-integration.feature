@wip @integration
Feature: PlanProvider License Integration
  As a LangWatch self-hosted deployment
  I want planProvider to use license-based limits
  So that existing enforcement code automatically works with licenses

  Background:
    Given I am in self-hosted mode (not SaaS)
    And an organization exists

  # ============================================================================
  # License-Based Plan Resolution
  # ============================================================================

  Scenario: Returns FREE type when no license
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then the plan type is "FREE"

  Scenario: Limits to 1 member when no license
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then maxMembers is 1

  Scenario: Limits to 2 projects when no license
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then maxProjects is 2

  Scenario: Returns license plan type when valid license exists
    Given the organization has a valid license with plan type "GROWTH"
    When I call planProvider.getActivePlan
    Then the plan type is "GROWTH"

  Scenario: Returns FREE type when license is expired
    Given the organization has an expired license
    When I call planProvider.getActivePlan
    Then the plan type is "FREE"

  Scenario: Returns FREE type when license is invalid
    Given the organization has an invalid license
    When I call planProvider.getActivePlan
    Then the plan type is "FREE"

  # ============================================================================
  # LicenseHandler Singleton
  # ============================================================================

  Scenario: getLicenseHandler returns same instance
    When I call getLicenseHandler twice
    Then both calls return the same instance

  # ============================================================================
  # LicenseHandler.getLicenseStatus
  # ============================================================================

  Scenario: getLicenseStatus returns hasLicense=false when no license
    Given the organization has no license
    When I call getLicenseStatus
    Then hasLicense is false
    And valid is false
    And plan is undefined

  Scenario: getLicenseStatus returns valid=true for valid license
    Given the organization has a valid license with plan type "GROWTH"
    When I call getLicenseStatus
    Then hasLicense is true
    And valid is true
    And plan is "GROWTH"
    And expiresAt is defined
    And maxMembers is defined

  Scenario: getLicenseStatus returns valid=false for expired license with metadata
    Given the organization has an expired license
    When I call getLicenseStatus
    Then hasLicense is true
    And valid is false
    And plan is defined
    And expiresAt is defined

  Scenario: getLicenseStatus returns valid=false for tampered license
    Given the organization has a tampered license
    When I call getLicenseStatus
    Then hasLicense is true
    And valid is false

  Scenario: getLicenseStatus returns valid=false for malformed license
    Given the organization has a malformed license string
    When I call getLicenseStatus
    Then hasLicense is true
    And valid is false
    And plan is undefined

  # ============================================================================
  # LicenseHandler.validateAndStoreLicense
  # ============================================================================

  Scenario: validateAndStoreLicense succeeds with valid license
    Given a valid license key for plan "ENTERPRISE"
    When I call validateAndStoreLicense with the license key
    Then the result is success
    And the planInfo type is "ENTERPRISE"
    And the license is stored in the database
    And licenseExpiresAt is set
    And licenseLastValidatedAt is set

  Scenario: validateAndStoreLicense fails for invalid format
    Given an invalid license string "garbage-data"
    When I call validateAndStoreLicense with the license key
    Then the result is failure
    And the error is "Invalid license format"
    And no license is stored in the database

  Scenario: validateAndStoreLicense fails for invalid signature
    Given a tampered license key
    When I call validateAndStoreLicense with the license key
    Then the result is failure
    And the error is "Invalid signature"

  Scenario: validateAndStoreLicense fails for expired license
    Given an expired license key
    When I call validateAndStoreLicense with the license key
    Then the result is failure
    And the error is "License expired"

  Scenario: validateAndStoreLicense throws for non-existent org
    Given a valid license key
    And an organization ID that does not exist
    When I call validateAndStoreLicense with the license key
    Then OrganizationNotFoundError is thrown

  Scenario: validateAndStoreLicense replaces existing license
    Given the organization has a valid license with plan type "PRO"
    And a new valid license key for plan "ENTERPRISE"
    When I call validateAndStoreLicense with the new license key
    Then the result is success
    And the planInfo type is "ENTERPRISE"
    And the old license is replaced

  # ============================================================================
  # LicenseHandler.removeLicense
  # ============================================================================

  Scenario: removeLicense clears existing license
    Given the organization has a valid license
    When I call removeLicense
    Then the result has removed=true
    And the license is null in the database
    And licenseExpiresAt is null
    And licenseLastValidatedAt is null

  Scenario: removeLicense is idempotent when no license exists
    Given the organization has no license
    When I call removeLicense
    Then the result has removed=true

  Scenario: removeLicense throws for non-existent org
    Given an organization ID that does not exist
    When I call removeLicense
    Then OrganizationNotFoundError is thrown

  # ============================================================================
  # LicenseHandler.getActivePlan
  # ============================================================================

  Scenario: getActivePlan returns FREE_PLAN when no license
    Given the organization has no license
    When I call getActivePlan
    Then the plan type is "FREE"
    And maxMembers is 1

  Scenario: getActivePlan returns license plan when valid
    Given the organization has a valid license with plan type "GROWTH" and maxMembers 25
    When I call getActivePlan
    Then the plan type is "GROWTH"
    And maxMembers is 25

  Scenario: getActivePlan returns FREE_PLAN when license expired
    Given the organization has an expired license
    When I call getActivePlan
    Then the plan type is "FREE"

  Scenario: getActivePlan returns FREE_PLAN when license tampered
    Given the organization has a tampered license
    When I call getActivePlan
    Then the plan type is "FREE"
