Feature: License Enforcement Refactor
  As a self-hosted LangWatch administrator
  I want license enforcement to be enabled by default
  So that the system is secure out of the box and I can disable it explicitly when needed

  Background:
    Given the system is a self-hosted deployment

  # ============================================================================
  # Environment Variable Inversion (LICENSE_ENFORCEMENT_DISABLED)
  # ============================================================================

  @unit
  Scenario: License enforcement is enabled by default when no env var is set
    Given LICENSE_ENFORCEMENT_DISABLED is not set
    When the subscription handler checks the active plan
    Then license enforcement should be active

  @unit
  Scenario: License enforcement is disabled when env var is set to true
    Given LICENSE_ENFORCEMENT_DISABLED is set to "true"
    When the subscription handler checks the active plan
    Then license enforcement should be disabled
    And the UNLIMITED_PLAN should be returned

  @unit
  Scenario: License enforcement is enabled when env var is set to false
    Given LICENSE_ENFORCEMENT_DISABLED is set to "false"
    When the subscription handler checks the active plan
    Then license enforcement should be active

  @unit
  Scenario: Env var accepts "1" as truthy value for disabled
    Given LICENSE_ENFORCEMENT_DISABLED is set to "1"
    When the subscription handler checks the active plan
    Then license enforcement should be disabled

  # ============================================================================
  # Truly Unlimited Plan (Infinity instead of 999_999)
  # ============================================================================

  @unit
  Scenario: UNLIMITED_PLAN uses Number.MAX_SAFE_INTEGER for limits when enforcement is disabled
    Given LICENSE_ENFORCEMENT_DISABLED is set to "true"
    When the subscription handler returns the UNLIMITED_PLAN
    Then maxMessagesPerMonth should be Number.MAX_SAFE_INTEGER
    And maxMembers should be Number.MAX_SAFE_INTEGER
    And maxProjects should be Number.MAX_SAFE_INTEGER
    And maxWorkflows should be Number.MAX_SAFE_INTEGER
    And maxPrompts should be Number.MAX_SAFE_INTEGER
    And maxEvaluators should be Number.MAX_SAFE_INTEGER
    And maxScenarios should be Number.MAX_SAFE_INTEGER
    And evaluationsCredit should be Number.MAX_SAFE_INTEGER
    # Note: We use Number.MAX_SAFE_INTEGER instead of Infinity because
    # JSON.stringify(Infinity) returns null, causing silent failures in tRPC

  @integration
  Scenario: Trace ingestion accepts unlimited traces when enforcement is disabled
    Given LICENSE_ENFORCEMENT_DISABLED is set to "true"
    And an organization exists
    When 1,000,000 traces are ingested
    Then all traces should be accepted without limit errors

  # ============================================================================
  # maxMembersLite in License Schema
  # ============================================================================

  @unit
  Scenario: License schema accepts maxMembersLite as optional field
    Given a license payload with maxMembersLite set to 5
    When the license is validated
    Then the license should be valid
    And maxMembersLite should be 5 in the parsed license data

  @unit
  Scenario: License schema defaults maxMembersLite when not provided
    Given a license payload without maxMembersLite
    When the license is validated
    Then the license should be valid
    And maxMembersLite should default to 1 in the plan info

  @unit
  Scenario: License plan mapping preserves maxMembersLite
    Given a validated license with maxMembersLite set to 10
    When the license is mapped to PlanInfo
    Then the PlanInfo should have maxMembersLite equal to 10

  @integration
  Scenario: License with maxMembersLite is stored and retrieved correctly
    Given LICENSE_ENFORCEMENT_DISABLED is set to "false"
    And a valid license key with maxMembersLite set to 3
    When the license is uploaded to an organization
    Then the stored license should include maxMembersLite
    And the active plan should show maxMembersLite as 3

  # ============================================================================
  # PlanInfo Type Updates (maxMembers and maxMembersLite defaults)
  # ============================================================================

  @unit
  Scenario: PlanInfo defaults maxMembers to 1 when not specified
    Given a plan without explicit maxMembers
    When the plan is constructed
    Then maxMembers should default to 1

  @unit
  Scenario: PlanInfo defaults maxMembersLite to 1 when not specified
    Given a plan without explicit maxMembersLite
    When the plan is constructed
    Then maxMembersLite should default to 1

  # ============================================================================
  # Settings Menu - License Link
  # ============================================================================

  @e2e
  Scenario: License link appears in settings menu after Subscription
    Given a user is logged in
    When the user navigates to any settings page
    Then the settings sidebar should display "License" link
    And "License" should appear after "Subscription" in the menu

  @integration
  Scenario: License settings page is accessible
    Given a user is logged in with organization access
    When the user navigates to "/settings/license"
    Then the license settings page should load successfully

  # ============================================================================
  # License Details Card - Extended Information
  # ============================================================================

  @e2e
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

  @integration
  Scenario: License status API returns all limit fields
    Given LICENSE_ENFORCEMENT_DISABLED is set to "false"
    And an organization with a valid license
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

  @unit
  Scenario: License details card handles Infinity display
    Given an organization with UNLIMITED_PLAN
    When the license details are rendered
    Then limits should display "Unlimited" instead of Infinity
    And limits should display "Unlimited" instead of 999999

  @integration
  Scenario: License status counts current resource usage
    Given an organization with:
      | members              | 3 |
      | lite_members         | 2 |
      | projects             | 5 |
      | prompts              | 10 |
      | workflows            | 8 |
      | scenarios            | 4 |
      | evaluators           | 6 |
      | messages_per_month   | 500 |
      | evaluations_credit   | 25 |
    When the license status is requested
    Then currentMembers should be 3
    And currentMembersLite should be 2
    And currentProjects should be 5
    And currentPrompts should be 10
    And currentWorkflows should be 8
    And currentScenarios should be 4
    And currentEvaluators should be 6
    And currentMessagesPerMonth should be 500
    And currentEvaluationsCredit should be 25

  # ============================================================================
  # Backward Compatibility
  # ============================================================================

  @unit
  Scenario: Old LICENSE_ENFORCEMENT_ENABLED env var is no longer recognized
    Given LICENSE_ENFORCEMENT_ENABLED is set to "true"
    And LICENSE_ENFORCEMENT_DISABLED is not set
    When the subscription handler checks the active plan
    Then license enforcement should be active
    And LICENSE_ENFORCEMENT_ENABLED should have no effect

  @integration
  Scenario: Existing licenses without maxMembersLite remain valid
    Given LICENSE_ENFORCEMENT_DISABLED is set to "false"
    And an existing license without maxMembersLite field
    When the license is validated
    Then the license should be valid
    And maxMembersLite should default to 1

  # ============================================================================
  # Error Handling
  # ============================================================================

  @unit
  Scenario: Invalid LICENSE_ENFORCEMENT_DISABLED value defaults to false
    Given LICENSE_ENFORCEMENT_DISABLED is set to "invalid"
    When the subscription handler checks the active plan
    Then license enforcement should be active
