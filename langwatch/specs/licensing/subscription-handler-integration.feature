@integration
Feature: SubscriptionHandler License Integration
  As a LangWatch self-hosted deployment
  I want SubscriptionHandler to use license-based limits
  So that existing enforcement code automatically works with licenses

  Background:
    Given I am in self-hosted mode (not SaaS)
    And an organization exists

  # ============================================================================
  # Default Behavior (LICENSE_ENFORCEMENT_ENABLED not set or false)
  # Backward compatible: always returns UNLIMITED_PLAN
  # ============================================================================

  Scenario: Returns SELF_HOSTED type when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is not set
    And the organization has no license
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "SELF_HOSTED"

  Scenario: Allows unlimited members when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is not set
    When I call SubscriptionHandler.getActivePlan
    Then maxMembers is 99999

  Scenario: Overrides adding limitations when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is not set
    When I call SubscriptionHandler.getActivePlan
    Then overrideAddingLimitations is true

  Scenario: Ignores valid license when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is not set
    And the organization has a valid license with maxMembers 10
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "SELF_HOSTED"

  # ============================================================================
  # Enforcement Enabled: LICENSE_ENFORCEMENT_ENABLED=true
  # ============================================================================

  Scenario: Returns FREE type when no license and enforcement enabled
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has no license
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "FREE"

  Scenario: Limits to 2 members when no license and enforcement enabled
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has no license
    When I call SubscriptionHandler.getActivePlan
    Then maxMembers is 2

  Scenario: Limits to 2 projects when no license and enforcement enabled
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has no license
    When I call SubscriptionHandler.getActivePlan
    Then maxProjects is 2

  Scenario: Returns license plan type when valid license exists
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has a valid license with plan type "GROWTH"
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "GROWTH"

  Scenario: Returns FREE type when license is expired
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has an expired license
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "FREE"

  Scenario: Returns FREE type when license is invalid
    Given LICENSE_ENFORCEMENT_ENABLED is "true"
    And the organization has an invalid license
    When I call SubscriptionHandler.getActivePlan
    Then the plan type is "FREE"

  # ============================================================================
  # LicenseHandler Singleton
  # ============================================================================

  Scenario: getLicenseHandler returns same instance
    When I call getLicenseHandler twice
    Then both calls return the same instance
