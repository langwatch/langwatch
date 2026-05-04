Feature: License Enforcement
  As a self-hosted LangWatch administrator
  I want license enforcement to manage plan limits
  So that the system enforces appropriate limits based on organization licenses

  Background:
    Given the system is a self-hosted deployment

  # ============================================================================
  # maxMembersLite in License Schema
  # ============================================================================

  @unit @unimplemented
  Scenario: License schema accepts maxMembersLite as optional field
    Given a license payload with maxMembersLite set to 5
    When the license is validated
    Then the license should be valid
    And maxMembersLite should be 5 in the parsed license data

  @integration @unimplemented
  Scenario: License with maxMembersLite is stored and retrieved correctly
    Given a valid license key with maxMembersLite set to 3
    When the license is uploaded to an organization
    Then the stored license should include maxMembersLite
    And the active plan should show maxMembersLite as 3

  # ============================================================================
  # PlanInfo Type Updates (maxMembers and maxMembersLite defaults)
  # ============================================================================

  @unit @unimplemented
  Scenario: PlanInfo defaults maxMembers to 1 when not specified
    Given a plan without explicit maxMembers
    When the plan is constructed
    Then maxMembers should default to 1

  @unit @unimplemented
  Scenario: PlanInfo defaults maxMembersLite to 1 when not specified
    Given a plan without explicit maxMembersLite
    When the plan is constructed
    Then maxMembersLite should default to 1

  # ============================================================================
  # Settings Menu - License Link
  # ============================================================================

  @e2e @unimplemented
  Scenario: License link appears in settings menu after Subscription
    Given a user is logged in
    When the user navigates to any settings page
    Then the settings sidebar should display "License" link
    And "License" should appear after "Subscription" in the menu

  @integration @unimplemented
  Scenario: License settings page is accessible
    Given a user is logged in with organization access
    When the user navigates to "/settings/license"
    Then the license settings page should load successfully

  # ============================================================================
  # License Details Card - Extended Information
  # ============================================================================

  @e2e @unimplemented
  Scenario: License details card displays all plan limits
    Given a user is logged in
    And the organization has a valid license
    When the user views the license settings page
    Then the license card should display "Members" with current and max values
    And the license card should display "Members Lite" with current and max values
    And the license card should display "Projects" with current and max values
    And the license card should display "Prompts" with current and max values
    And the license card should display "Workflows" with current and max values
    And the license card should display "Scenarios" with current and max values
    And the license card should display "Evaluators" with current and max values

  @integration @unimplemented
  Scenario: License status API returns all limit fields
    Given an organization with a valid license
    When the license status is requested
    Then the response should include currentMembers and maxMembers
    And the response should include currentMembersLite and maxMembersLite
    And the response should include currentProjects and maxProjects
    And the response should include currentPrompts and maxPrompts
    And the response should include currentWorkflows and maxWorkflows
    And the response should include currentScenarios and maxScenarios
    And the response should include currentEvaluators and maxEvaluators
    And the response should include currentMessagesPerMonth and maxMessagesPerMonth
    And the response should include currentEvaluationsCredit and maxEvaluationsCredit

  @unit @unimplemented
  Scenario: License details card handles Infinity display
    Given an organization with UNLIMITED_PLAN
    When the license details are rendered
    Then limits should display "Unlimited" instead of Infinity
    And limits should display "Unlimited" instead of 999999

  # ============================================================================
  # Backward Compatibility
  # ============================================================================

