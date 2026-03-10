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

  @integration
  Scenario Outline: Creating a <resource> via API is blocked when at limit
    Given the organization allows 3 <resource>
    And the organization has 3 <resource>
    When I create a <resource> via the API
    Then the request is rejected as forbidden

    Examples:
      | resource   |
      | prompt     |
      | scenario   |
      | evaluator  |

  @integration
  Scenario Outline: Creating a <resource> via API succeeds when under limit
    Given the organization allows 10 <resource>
    And the organization has 3 <resource>
    When I create a <resource> via the API
    Then the <resource> is created

    Examples:
      | resource   |
      | prompt     |
      | scenario   |
      | evaluator  |

  # ============================================================================
  # Non-create operations are never blocked
  # ============================================================================

  @integration
  Scenario: Listing prompts succeeds even at limit
    Given the organization has reached its prompt limit
    When I list prompts via the API
    Then the prompt list is returned

  @integration
  Scenario: Updating an evaluator succeeds even at limit
    Given the organization has reached its evaluator limit
    And an evaluator exists
    When I update the evaluator via the API
    Then the evaluator is updated

  @integration
  Scenario: Deleting a scenario succeeds even at limit
    Given the organization has reached its scenario limit
    And a scenario exists
    When I delete the scenario via the API
    Then the scenario is archived

  # ============================================================================
  # Customer-facing messages vary by plan source
  # ============================================================================

  @integration
  Scenario: Free SaaS user receives upgrade guidance when blocked
    Given the organization is on a free SaaS plan
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then the response tells me to upgrade my plan

  @integration
  Scenario: Paid SaaS user receives upgrade guidance when blocked
    Given the organization is on a paid SaaS subscription
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then the response tells me to upgrade my plan

  @integration
  Scenario: Self-hosted user without license receives license guidance when blocked
    Given the organization is self-hosted without a license
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then the response tells me to get a license

  @integration
  Scenario: Self-hosted user with license receives license upgrade guidance when blocked
    Given the organization is self-hosted with a license
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then the response tells me to upgrade my license

  # ============================================================================
  # Internal notifications when limits are hit
  # ============================================================================

  @integration
  Scenario: Team is notified when a resource limit is hit on SaaS
    Given the organization is on a SaaS plan
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then the team is notified about the limit being reached

  @integration
  Scenario: Notification is suppressed on self-hosted
    Given the organization is self-hosted
    And the organization has reached its prompt limit
    When I create a prompt via the API
    Then no notification is sent

  @integration
  Scenario: Repeated blocked requests suppress duplicate notifications
    Given the organization has reached its prompt limit
    And a notification was already sent recently
    When I create a prompt via the API
    Then no additional notification is sent

  # ============================================================================
  # Parity with dashboard
  # ============================================================================

  @integration
  Scenario: Second create is rejected after reaching limit via API
    Given the organization allows 3 prompts
    And the organization has 2 prompts
    And a prompt was just created via the API
    When I create another prompt via the API
    Then the request is rejected as forbidden
