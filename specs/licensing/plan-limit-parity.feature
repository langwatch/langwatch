Feature: Plan limit parity between SaaS subscription and self-hosted license
  As a platform operator
  I want the same enforcement logic to apply regardless of plan source
  So that self-hosted license users get identical limit enforcement as SaaS subscribers

  Background:
    Given the composite plan provider resolves plans with license-first precedence

  # --- Composite provider selection scenarios ---

  @unit
  Scenario: License-only organization uses license limits
    Given the organization has a valid Enterprise license
    And the organization has no SaaS subscription
    When the composite provider resolves the active plan
    Then the plan source is "license"
    And the SaaS provider is not called

  @unit
  Scenario: Subscription-only organization uses SaaS limits
    Given the organization has no license
    And the organization has an active Pro subscription
    When the composite provider resolves the active plan
    Then the plan source is "subscription"
    And the plan type is "PRO"

  @unit
  Scenario: Organization with both license and subscription uses license
    Given the organization has a valid Enterprise license
    And the organization has an active Pro subscription
    When the composite provider resolves the active plan
    Then the plan source is "license"
    And the SaaS provider is not called

  @unit
  Scenario: Expired license falls through to SaaS subscription
    Given the organization has an expired license
    And the organization has an active Pro subscription
    When the composite provider resolves the active plan
    Then the plan source is "subscription"
    And the plan type is "PRO"

  @unit
  Scenario: Expired license without subscription falls to FREE
    Given the organization has an expired license
    And the organization has no SaaS subscription
    When the composite provider resolves the active plan
    Then the plan source is "free"
    And the plan type is "FREE"

  @unit
  Scenario: No license and no subscription falls to FREE
    Given the organization has no license
    And the organization has no SaaS subscription
    When the composite provider resolves the active plan
    Then the plan source is "free"
    And the plan type is "FREE"

  @unit
  Scenario: License wins even when subscription has more generous limits
    Given the organization has a valid license with maxMembers 10
    And the organization has an active subscription with maxMembers 50
    When the composite provider resolves the active plan
    Then the plan source is "license"
    And maxMembers is 10

  # --- Field completeness scenarios ---

  @unit
  Scenario: License-sourced plan populates all limit fields
    Given a license with all optional fields omitted
    When the license is mapped to PlanInfo
    Then all 16 numeric limit fields have defined values
    And usageUnit defaults to "traces"

  @unit
  Scenario: SaaS-sourced plan populates all limit fields
    Given an active subscription on any paid plan
    When the SaaS provider resolves the plan
    Then all 16 numeric limit fields have defined values

  # --- overrideAddingLimitations consistency ---

  @unit
  Scenario: Override is false for non-impersonated user on license plan
    Given the organization has a valid license
    And the user is not impersonated
    When the composite provider resolves the active plan
    Then overrideAddingLimitations is false

  @unit
  Scenario: Override is true for admin-impersonated user on license plan
    Given the organization has a valid license
    And the user is impersonated by an admin
    When the composite provider resolves the active plan
    Then overrideAddingLimitations is true

  @unit
  Scenario: Override is false for non-impersonated user on SaaS plan
    Given the organization has no license
    And the organization has an active subscription
    And the user is not impersonated
    When the composite provider resolves the active plan
    Then overrideAddingLimitations is false

  @unit
  Scenario: Override is true for admin-impersonated user on SaaS plan
    Given the organization has no license
    And the organization has an active subscription
    And the user is impersonated by an admin
    When the composite provider resolves the active plan
    Then overrideAddingLimitations is true
