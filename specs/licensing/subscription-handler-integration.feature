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

  # A license sells the Enterprise surface and the support relationship, not
  # permission to run the software, so a deployment without one is uncapped on
  # everything it hosts itself. A seat cap here is what stops a self-hosted
  # customer adding their second colleague.

  Scenario: An unlicensed deployment runs on the Open Source plan
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then the active plan is the Open Source plan
    And seats are uncapped

  # A license past its end date is still one we signed, so its seat count keeps
  # binding rather than dissolving into the uncapped baseline. See
  # expired-license-enforcement.feature.

  Scenario: An expired license keeps the seats it sold
    Given the organization has an expired license for 5 members
    When I call planProvider.getActivePlan
    Then the active plan is the one the license names
    And seats are capped at 5

  Scenario: An unreadable license leaves the deployment on the Open Source plan
    Given the organization has a tampered license
    When I call planProvider.getActivePlan
    Then the active plan is the Open Source plan
    And seats are uncapped

  # ============================================================================
  # LicenseHandler Singleton
  # ============================================================================

  Scenario: getLicenseHandler returns same instance
    When I call getLicenseHandler twice
    Then both calls return the same instance

  # ============================================================================
  # LicenseHandler.getLicenseStatus
  # ============================================================================

  # ============================================================================
  # LicenseHandler.validateAndStoreLicense
  # ============================================================================

  # ============================================================================
  # LicenseHandler.removeLicense
  # ============================================================================

  # ============================================================================
  # LicenseHandler.getActivePlan
  # ============================================================================

