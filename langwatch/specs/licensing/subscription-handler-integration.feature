@integration
Feature: SubscriptionHandler License Integration
  As a LangWatch self-hosted deployment
  I want SubscriptionHandler to use license-based limits
  So that existing enforcement code automatically works with licenses

  Background:
    Given I am in self-hosted mode (not SaaS)
    And an organization exists with id "org-123"

  # ============================================================================
  # Integration with LicenseHandler
  # ============================================================================

  Scenario: SubscriptionHandler delegates to LicenseHandler
    Given the organization has a valid license with maxMembers 15
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then maxMembers is 15

  Scenario: SubscriptionHandler returns UNLIMITED when no license
    Given the organization has no license
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then the plan type is "SELF_HOSTED"
    And maxMembers is 99999

  Scenario: SubscriptionHandler returns FREE for invalid license
    Given the organization has an invalid license
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then the plan type is "FREE"
    And maxMembers is 2

  # ============================================================================
  # Feature Flag Behavior
  # ============================================================================

  Scenario: Respects LICENSE_ENFORCEMENT_ENABLED=false
    Given the organization has a valid license with maxMembers 5
    And LICENSE_ENFORCEMENT_ENABLED is "false"
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then the plan type is "SELF_HOSTED"
    And maxMembers is 99999

  Scenario: Enforces limits when LICENSE_ENFORCEMENT_ENABLED=true
    Given the organization has a valid license with maxMembers 5
    And LICENSE_ENFORCEMENT_ENABLED is "true"
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then maxMembers is 5

  # ============================================================================
  # API Compatibility
  # ============================================================================

  Scenario: Maintains user parameter compatibility
    Given the organization has a valid license
    And a user object is provided
    When I call SubscriptionHandler.getActivePlan for "org-123" with user
    Then the call succeeds
    And the result is the same as without user

  Scenario: Returns correct PlanInfo structure
    Given the organization has a valid license with:
      | type                | ENTERPRISE |
      | maxMembers          | 100        |
      | maxProjects         | 50         |
      | maxMessagesPerMonth | 500000     |
      | evaluationsCredit   | 200        |
      | maxWorkflows        | 100        |
      | canPublish          | true       |
    When I call SubscriptionHandler.getActivePlan for "org-123"
    Then the result has all required PlanInfo fields:
      | type                     |
      | name                     |
      | free                     |
      | maxMembers               |
      | maxProjects              |
      | maxMessagesPerMonth      |
      | evaluationsCredit        |
      | maxWorkflows             |
      | canPublish               |
      | overrideAddingLimitations|
      | prices                   |

  # ============================================================================
  # SaaS Mode Unchanged
  # ============================================================================

  Scenario: SaaS mode continues using SubscriptionHandlerSaas
    Given I am in SaaS mode (IS_SAAS is true)
    When the dependency injection loads SubscriptionHandler
    Then SubscriptionHandlerSaas is used instead of base SubscriptionHandler
