@unit
Feature: Subscription Limit Overrides
  As a LangWatch Cloud operator
  I want per-subscription overrides to take precedence over plan defaults
  So that I can customize limits for individual organizations without creating new plans

  Background:
    Given a SaaS organization with an active subscription on a known plan

  # ============================================================================
  # Existing Overrides Still Work
  # ============================================================================

  @unimplemented
  Scenario: Subscription with a project override uses that value
    Given the subscription overrides project capacity to 50
    When the plan is resolved for the organization
    Then the plan allows 50 projects

  @unimplemented
  Scenario: Subscription with a monthly message override uses that value
    Given the subscription overrides monthly message capacity to 500000
    When the plan is resolved for the organization
    Then the plan allows 500000 messages per month

  # ============================================================================
  # Bug Fix: maxWorkflows Override Is Applied
  # ============================================================================

  # ============================================================================
  # New Numeric Overrides Are Applied
  # ============================================================================

  # ============================================================================
  # Null Overrides Fall Back to Plan Defaults
  # ============================================================================

  @unimplemented
  Scenario: Only non-null overrides replace plan defaults
    Given the subscription overrides member capacity to 20
    And all other override fields are null
    When the plan is resolved for the organization
    Then the plan allows 20 members
    And all other limits match the base plan defaults

  # ============================================================================
  # Zero Values Are Preserved
  # ============================================================================

  # ============================================================================
  # Multiple Overrides Combine
  # ============================================================================

  @unimplemented
  Scenario: Several overrides are applied together
    Given the subscription overrides member capacity to 20
    And the subscription overrides workflow capacity to 50
    And the subscription overrides prompt capacity to 30
    And the subscription overrides monthly message capacity to 200000
    When the plan is resolved for the organization
    Then the plan allows 20 members
    And the plan allows 50 workflows
    And the plan allows 30 prompts
    And the plan allows 200000 messages per month
    And all non-overridden limits match the base plan defaults

  # ============================================================================
  # Unknown Plan Key Falls Back to Free With Overrides
  # ============================================================================

  # ============================================================================
  # Cancellation Clears All Override Fields
  # ============================================================================

  @unimplemented
  Scenario: Cancelled subscription nullifies all override fields
    Given the subscription had overrides for multiple limits
    When the subscription is cancelled
    Then all override fields are cleared
