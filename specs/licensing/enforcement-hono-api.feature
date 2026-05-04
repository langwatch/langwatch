Feature: Resource limit enforcement on API endpoints
  As a platform operator
  I want the API to enforce the same resource limits as the dashboard
  So that users cannot bypass plan limits by creating resources via the API directly

  Background:
    Given an organization exists with a project
    And the project has a valid API key
    And the organization has a plan with resource limits

  # ============================================================================
  # Creating resources is blocked when limits are reached
  # ============================================================================

  # ============================================================================
  # Non-create operations are never blocked
  # ============================================================================

  @integration @unimplemented
  Scenario: Listing prompts succeeds even at limit
    Given the organization has reached its prompt limit
    When I list prompts via the API
    Then the prompt list is returned

  @integration @unimplemented
  Scenario: Updating an evaluator succeeds even at limit
    Given the organization has reached its evaluator limit
    And an evaluator exists
    When I update the evaluator via the API
    Then the evaluator is updated

  @integration @unimplemented
  Scenario: Deleting a scenario succeeds even at limit
    Given the organization has reached its scenario limit
    And a scenario exists
    When I delete the scenario via the API
    Then the scenario is archived

  # ============================================================================
  # Customer-facing messages vary by plan source
  # ============================================================================

  # ============================================================================
  # Internal notifications when limits are hit
  # ============================================================================

  @integration @unimplemented
  Scenario: Notification is suppressed on self-hosted
    Given the organization is self-hosted
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then no notification is sent

  @integration @unimplemented
  Scenario: Repeated blocked requests suppress duplicate notifications
    Given the organization has reached its prompt limit
    And a notification was already sent recently
    When I create a prompt via the API
    Then no additional notification is sent

  # ============================================================================
  # Parity with dashboard
  # ============================================================================

  @integration @unimplemented
  Scenario: Second create is rejected after reaching limit via API
    Given the organization allows 3 prompts
    And the organization has 2 prompts
    And a prompt was just created via the API
    When I create another prompt via the API
    Then the request is rejected as forbidden
