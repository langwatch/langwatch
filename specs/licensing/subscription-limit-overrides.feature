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
  Scenario: Subscription with a member override uses that value
    Given the subscription overrides member capacity to 20
    When the plan is resolved for the organization
    Then the plan allows 20 members

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

  @unimplemented
  Scenario: Subscription with an evaluations credit override uses that value
    Given the subscription overrides evaluations credit to 100
    When the plan is resolved for the organization
    Then the plan allows 100 evaluations credits

  # ============================================================================
  # Bug Fix: maxWorkflows Override Is Applied
  # ============================================================================

  @unimplemented
  Scenario: Subscription with a workflow override uses that value
    Given the subscription overrides workflow capacity to 25
    When the plan is resolved for the organization
    Then the plan allows 25 workflows

  # ============================================================================
  # New Numeric Overrides Are Applied
  # ============================================================================

  @unimplemented
  Scenario: Subscription with a lite-member override uses that value
    Given the subscription overrides lite-member capacity to 15
    When the plan is resolved for the organization
    Then the plan allows 15 lite members

  @unimplemented
  Scenario: Subscription with a team override uses that value
    Given the subscription overrides team capacity to 10
    When the plan is resolved for the organization
    Then the plan allows 10 teams

  @unimplemented
  Scenario: Subscription with a prompt override uses that value
    Given the subscription overrides prompt capacity to 30
    When the plan is resolved for the organization
    Then the plan allows 30 prompts

  @unimplemented
  Scenario: Subscription with an evaluator override uses that value
    Given the subscription overrides evaluator capacity to 40
    When the plan is resolved for the organization
    Then the plan allows 40 evaluators

  @unimplemented
  Scenario: Subscription with a scenario override uses that value
    Given the subscription overrides scenario capacity to 20
    When the plan is resolved for the organization
    Then the plan allows 20 scenarios

  @unimplemented
  Scenario: Subscription with an agent override uses that value
    Given the subscription overrides agent capacity to 12
    When the plan is resolved for the organization
    Then the plan allows 12 agents

  @unimplemented
  Scenario: Subscription with an experiment override uses that value
    Given the subscription overrides experiment capacity to 50
    When the plan is resolved for the organization
    Then the plan allows 50 experiments

  @unimplemented
  Scenario: Subscription with an online-evaluation override uses that value
    Given the subscription overrides online-evaluation capacity to 18
    When the plan is resolved for the organization
    Then the plan allows 18 online evaluations

  @unimplemented
  Scenario: Subscription with a dataset override uses that value
    Given the subscription overrides dataset capacity to 25
    When the plan is resolved for the organization
    Then the plan allows 25 datasets

  @unimplemented
  Scenario: Subscription with a dashboard override uses that value
    Given the subscription overrides dashboard capacity to 8
    When the plan is resolved for the organization
    Then the plan allows 8 dashboards

  @unimplemented
  Scenario: Subscription with a custom-graph override uses that value
    Given the subscription overrides custom-graph capacity to 15
    When the plan is resolved for the organization
    Then the plan allows 15 custom graphs

  @unimplemented
  Scenario: Subscription with an automation override uses that value
    Given the subscription overrides automation capacity to 22
    When the plan is resolved for the organization
    Then the plan allows 22 automations

  # ============================================================================
  # Null Overrides Fall Back to Plan Defaults
  # ============================================================================

  @unimplemented
  Scenario: Null override fields use the plan default values
    Given the subscription has no overrides set
    When the plan is resolved for the organization
    Then all limits match the base plan defaults

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

  @unimplemented
  Scenario: Zero override for lite members is applied as zero
    Given the subscription overrides lite-member capacity to 0
    When the plan is resolved for the organization
    Then the plan allows 0 lite members

  @unimplemented
  Scenario: Zero override for workflows is applied as zero
    Given the subscription overrides workflow capacity to 0
    When the plan is resolved for the organization
    Then the plan allows 0 workflows

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

  @unimplemented
  Scenario: Override on subscription with unknown plan applies over free defaults
    Given the subscription plan key is not recognized
    And the subscription overrides workflow capacity to 50
    When the plan is resolved for the organization
    Then the plan type is FREE
    And the plan allows 50 workflows

  # ============================================================================
  # Cancellation Clears All Override Fields
  # ============================================================================

  @unimplemented
  Scenario: Cancelled subscription nullifies all override fields
    Given the subscription had overrides for multiple limits
    When the subscription is cancelled
    Then all override fields are cleared
