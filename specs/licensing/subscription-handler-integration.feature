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

  Scenario: Limits members to FREE_PLAN limit when no license
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then maxMembers equals FREE_PLAN.maxMembers

  Scenario: Limits projects to FREE_PLAN limit when no license
    Given the organization has no license
    When I call planProvider.getActivePlan
    Then maxProjects equals FREE_PLAN.maxProjects

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

